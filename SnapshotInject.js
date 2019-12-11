'use strict';
const fs = require('fs');
const readline = require('readline');
const eosjs = require('eosjs');
const fetch = require('node-fetch');
const {TextDecoder, TextEncoder} = require('text-encoding');
const Throttle = require('promise-parallel-throttle');
const logger = require('single-line-log');
const log = logger.stdout;

class SnapshotHandler {

    constructor(opts) {
        this.jsonrpc = new eosjs.JsonRpc(opts.httpEndpoint, {fetch});
        this.shouldInject = opts.inject;
        this.shouldValidate = opts.validate;
        this.shouldValidateStake = opts.validateStake;
        this.shouldWriteCsv = opts.writeCsv;
        this.debugAccounts = opts.debugAccounts;
        this.debug = opts.debug;
        let sigProvider = this.shouldInject ? new eosjs.JsSignatureProvider([opts.privateKey]) : null;
        this.api = new eosjs.Api({
            rpc: this.jsonrpc,
            signatureProvider: sigProvider,
            textEncoder: new TextEncoder,
            textDecoder: new TextDecoder
        });
        this.snapshotInput = opts.snapshotInput;
        this.balancesChecked = 0;
        this.accountsCreated = 0;
        this.queuesWritten = 0;
        this.creationActionQueue = [];
        this.accounts = {};

        if (this.shouldWriteCsv) {
            this.snapshotOutput = opts.snapshotOutput;
            console.log("Writing to " + this.snapshotOutput);
            try {
                fs.unlinkSync(this.snapshotOutput);
            } catch (e) {
                console.warn(this.snapshotOutput + " did not yet exist");
            }
        }

    }

    forcePrecision(val) {
        return parseFloat(parseFloat(val, 10).toFixed(4), 10);
    }

    async run() {
        await this.checkIssued();
        await this.parseFile();
    }

    async checkIssued() {
        await this.jsonrpc.get_table_rows({
            code: "eosio.token",
            table: "stat",
            scope: "TLOS"
        }).then(res => {
            this.contractSupply = parseFloat(res.rows[0].supply.split(" ")[0]);
        });
    }

    checkBalance(acctResult) {
        let acctObj = this.accounts[acctResult.account_name];
        let liquid = acctResult.hasOwnProperty("core_liquid_balance") ? acctResult.core_liquid_balance.split(" ")[0] : 0;
        let cpu = acctResult.total_resources && acctResult.total_resources.hasOwnProperty("cpu_weight") ? acctResult.total_resources.cpu_weight.split(" ")[0] : 0;
        let net = acctResult.total_resources && acctResult.total_resources.hasOwnProperty("net_weight") ? acctResult.total_resources.net_weight.split(" ")[0] : 0;
        let liquidFloat = parseFloat(liquid);
        let cpuStakedFloat = parseFloat(cpu);
        let netStakedFloat = parseFloat(net);

        if (acctResult.hasOwnProperty("refund_request") && acctResult.refund_request) {
            cpuStakedFloat += parseFloat(acctResult.refund_request && acctResult.refund_request.hasOwnProperty("cpu_amount") ? acctResult.refund_request.cpu_amount.split(" ")[0] : 0);
            netStakedFloat += parseFloat(acctResult.refund_request && acctResult.refund_request.hasOwnProperty("net_amount") ? acctResult.refund_request.net_amount.split(" ")[0] : 0);
        }

        let foundBalance = (liquidFloat + cpuStakedFloat + netStakedFloat).toFixed(4);
        let snapshotBalance = parseFloat(acctObj.snapshotBalance.startsWith(".") ? "0" + acctObj.snapshotBalance : acctObj.snapshotBalance).toFixed(4);
        if (foundBalance != snapshotBalance)
            console.log(acctResult.account_name + " snapshot had balance: " + snapshotBalance + " but this script found: " + foundBalance);

        acctObj.balance = foundBalance;
    }

    async injectAccount(accountName) {
        let thisAcct = this.accounts[accountName];

        if (this.debug) {
            console.log(JSON.stringify(thisAcct, null, 4));
        }

        let actions = [{
            account: 'snapshots.tf',
            name: 'setbalance',
            authorization: [{
                actor: 'jesse.tf',
                permission: 'inject',
            }],
            data: {
                snapshot_id: 1,
                account: accountName,
                amount: Math.round(parseFloat(thisAcct.snapshotBalance.startsWith(".") ? "0" + thisAcct.snapshotBalance : thisAcct.snapshotBalance, 10) * 10000)
            }
        }];

        let createResult = await this.api.transact({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        }).then(r => {
            log("Created " + ++this.accountsCreated + " balances");
        }).catch(e => {
            console.log("Error while sending action: " + e.message + "\naction was: " + JSON.stringify(actions, null, 4));
            process.exit(1);
        });
    }

    async validateAccount(accountName) {
        let thisParser = this;
        await this.jsonrpc.get_account(accountName).then(acct => {
            this.checkBalance(acct);
        }).catch(err => {
            console.error("Error with accountName: " + accountName + " and error:\n" + err);
        });
    }

    writeRow(accountName) {
        let acct = this.accounts[accountName];
        if (!acct) {
            console.error("Couldn't get user object to write row: " + accountName);
        } else if (balanceInt !== 0) {
            writer.write(thisAcct.accountName +
                "," + thisAcct.balance +
                "," + thisAcct.cpuStake.toFixed(4) +
                "," + thisAcct.netStake.toFixed(4) +
                "," + thisAcct.liquid.toFixed(4) + "\n");
        }
    }

    async injectAll() {
        console.log("Injecting all accounts " + new Date());

        let actionBatches = [];
        let currentBatch = [];
        let max = 600;
        let accountList = Object.keys(this.accounts);
        for (let i = 0; i < accountList.length; i++) {
            if (currentBatch.length >= max) {
                actionBatches.push(currentBatch);
                currentBatch = [];
            }

            let accountName = accountList[i];
            let thisAcct = this.accounts[accountName];
            currentBatch.push({
                account: 'snapshots.tf',
                name: 'setbalance',
                authorization: [{
                    actor: 'jesse.tf',
                    permission: 'inject',
                }],
                data: {
                    snapshot_id: 1,
                    account: accountName,
                    amount: Math.round(parseFloat(thisAcct.snapshotBalance.startsWith(".") ? "0" + thisAcct.snapshotBalance : thisAcct.snapshotBalance, 10) * 10000)
                }});
        }

        if (currentBatch.length > 0)
            actionBatches.push(currentBatch);

        for (let i = 0; i < actionBatches.length; i++) {
            await this.api.transact({
                actions: actionBatches[i]
            }, {
                blocksBehind: 3,
                expireSeconds: 30,
            }).then(r => {
                log("Created " + ++this.accountsCreated + " balances");
            }).catch(e => {
                console.log("Error while sending action: " + e.message + "\naction was: " + JSON.stringify(actionBatches[i], null, 4));
                process.exit(1);
            });
        }

        console.log("Injecting complete " + new Date());
    }

    async validateAll() {
        console.log("Validating all accounts " + new Date());
        const queue = Object.keys(this.accounts).map(account => () => this.validateAccount(account));
        const completedQueue = await Throttle.all(queue, {
            maxInProgress: 8
        });
        console.log("Validating complete " + new Date());
    }

    async writeCsv() {
        for (let accountName in this.accounts)
            this.writeRow(accountName);
    }

    async parseFile() {
        console.log("Parsing: " + JSON.stringify(this.snapshotInput));

        let snapMeta = {
            account_count: 0,
            total_balance: 0.0
        };

        this.snapMeta = snapMeta;

        let accounts = {};

        let rl = readline.createInterface({
            input: fs.createReadStream(this.snapshotInput),
            terminal: false
        });

        let thisParser = this;

        rl.on('line', async function(line) {
            /*
            let parts = line.split(',');
            let accountName = parts[2];
            let pubKey = parts[3];
            let balance = parts[4];

            if (accountName.length != 12 || pubKey.length != 53) {
                console.log("CANNOT HANDLE THIS LINE, SKIPPING IT: " + line);
                return;
            }

            */
            snapMeta.account_count++;
            //let accountName = line.replace(/"/g, "")
            let parts = line.split(',');
            let accountName = parts[0];
            let snapshotBalance = parts[1];
            accounts[accountName] = {
                snapshotBalance
            };

        });

        rl.on('close', async function() {
            thisParser.accounts = accounts;
            if (thisParser.shouldInject)
                await thisParser.injectAll();

            if (thisParser.shouldValidate)
                await thisParser.validateAll();

            if (thisParser.shouldWriteCsv)
                await thisParser.writeCsv();

            console.log("Account count: " + snapMeta.account_count + "\n" +
                "Total balance: " + snapMeta.total_balance.toFixed(4));

            let contractSupply = thisParser.contractSupply.toFixed(4);
            let snapshotSupply = thisParser.snapMeta.total_balance.toFixed(4);
            if (contractSupply != snapshotSupply) {
                console.error("Contract supply was " + contractSupply + " TLOS and snapshot file had " + snapshotSupply + " TLOS, a difference of " + (thisParser.snapMeta.total_balance - thisParser.contractSupply).toFixed(4) + " TLOS\n\n");
            }
        });
    }
}

module.exports = SnapshotHandler;
