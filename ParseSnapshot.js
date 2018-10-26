'use strict'
const fs = require('fs');
const readline = require('readline');
const eosjs = require('eosjs');
const fetch = require('node-fetch');
const {TextDecoder, TextEncoder} = require('text-encoding');
const Throttle = require('promise-parallel-throttle');
const logger = require('single-line-log');
const ArgumentParser = require('argparse').ArgumentParser;
const log = logger.stdout;

class Parser {

    constructor(opts) {
        this.jsonrpc = new eosjs.JsonRpc(opts.httpEndpoint, {fetch});
        this.shouldInject = opts.inject;
        this.shouldValidate = opts.validate;
        this.shouldValidateStake = opts.validateStake;
        this.shouldWriteCsv = opts.writeCsv;
        this.debugAccounts = opts.debugAccounts;
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

    async parse() {
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
        let liquid = acctResult.core_liquid_balance.split(" ")[0];
        let cpu = acctResult.total_resources.cpu_weight.split(" ")[0];
        let net = acctResult.total_resources.net_weight.split(" ")[0];
        let liquidFloat = parseFloat(liquid);
        let cpuStakedFloat = parseFloat(cpu);
        let netStakedFloat = parseFloat(net);
        if (this.shouldValidateStake) {
            if (cpu != acctObj.cpuStake.toFixed(4))
                console.error("Account: " + acctResult.account_name + " did not have expected cpu: " + acctObj.cpuStake.toFixed(4) + " it had: " + cpu + "\n\n");

            if (net != acctObj.netStake.toFixed(4))
                console.error("Account: " + acctResult.account_name + " did not have expected net: " + acctObj.netStake.toFixed(4) + " it had: " + net+ "\n\n");
        }

        if (liquid != acctObj.liquid.toFixed(4))
            console.error("Account: " + acctResult.account_name + " did not have expected liquid: " + acctObj.liquid.toFixed(4) + " it had: " + liquid + "\n\n");

        let foundBalance = (liquidFloat + cpuStakedFloat + netStakedFloat).toFixed(4);
        let expectedBalance = acctObj.balance.toFixed(4);
        if (expectedBalance != foundBalance) {
            console.error("Account: " + acctResult.account_name + " did not have expected balance: " + expectedBalance + " it had: " + foundBalance + "\n\n");
        } else {
            if (++this.balancesChecked % 1000 === 0) {
                //log("Checked " + this.balancesChecked + " out of " + this.snapMeta.account_count + " accounts\n");
                log(cpu + "+" + net + "+" + liquid + "=" + foundBalance + " and expected " + expectedBalance + " for account " + acctResult.account_name + "\nChecked " + this.balancesChecked + " out of " + this.snapMeta.account_count + " accounts\n");
            }
        }
    }

    async injectAccount(accountName) {
        let thisAcct = this.accounts[accountName];
        let actions = [{
            account: 'eosio',
            name: 'newaccount',
            authorization: [{
                actor: 'eosio',
                permission: 'active',
            }],
            data: {
                creator: 'eosio',
                name: accountName,
                owner: {
                    threshold: 1,
                    keys: [{
                        key: thisAcct.pubKey,
                        weight: 1
                    }],
                    accounts: [],
                    waits: []
                },
                active: {
                    threshold: 1,
                    keys: [{
                        key: thisAcct.pubKey,
                        weight: 1
                    }],
                    accounts: [],
                    waits: []
                },
            },
        }, {
            account: 'eosio',
            name: 'buyrambytes',
            authorization: [{
                actor: 'eosio',
                permission: 'active',
            }],
            data: {
                payer: 'eosio',
                receiver: accountName,
                bytes: 4096,
            },
        }, {
            account: 'eosio',
            name: 'delegatebw',
            authorization: [{
                actor: 'eosio',
                permission: 'active',
            }],
            data: {
                from: 'eosio',
                receiver: accountName,
                stake_net_quantity: thisAcct.netStake.toFixed(4) + ' TLOS',
                stake_cpu_quantity: thisAcct.cpuStake.toFixed(4) + ' TLOS',
                transfer: true,
            }
        }, {
            account: 'eosio.token',
            name: 'transfer',
            authorization: [{
                actor: 'eosio',
                permission: 'active',
            }],
            data: {
                from: 'eosio',
                to: accountName,
                quantity: thisAcct.liquid.toFixed(4) + ' TLOS',
                memo: 'TLOS Genesis'
            }
        }];
        this.creationActionQueue = this.creationActionQueue.concat(actions);
        this.accountsCreated++;
        if (this.creationActionQueue.length > 599)
            await this.writeActionQueue();
    }

    async writeActionQueue() {
        if (this.creationActionQueue.length === 0)
            return;

        let createResult = await this.api.transact({
            actions: this.creationActionQueue
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        }).then(r => {
            this.creationActionQueue = [];
            log("Created " + this.accountsCreated + " accounts");
        }).catch(e => {
            throw Error("Failed to create " + this.creationActionQueue.length + "accounts: " + e);
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
        const queue = Object.keys(this.accounts).map(account => () => this.injectAccount(account));
        const completedQueue = await Throttle.all(queue, {
            maxInProgress: 1
        });
        this.writeActionQueue();
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
            let parts = line.split(',');
            let accountName = parts[2];
            let pubKey = parts[3];
            let balance = parts[4];

            snapMeta.account_count++;
            let balanceFloat = parseFloat(balance);
            snapMeta.total_balance += balanceFloat;

            let liquid;
            if (balance <= 3)
                liquid = .1;
            else if (balance > 3 && balance <= 11)
                liquid = 2;
            else
                liquid = 10;


            let remainder = thisParser.forcePrecision(balance - liquid);
            let cpuStake = thisParser.forcePrecision(remainder / 2);
            let netStake = thisParser.forcePrecision(remainder - cpuStake);

            if (thisParser.debugAccounts.indexOf(accountName) > -1) {
                console.log("Account " + accountName + " =========");
                console.log("balance: " + balance);
                console.log("remainder: " + remainder);
                console.log("liquid: " + liquid);
                console.log("cpuStake: " + cpuStake);
                console.log("netStake: " + netStake);
            }

            accounts[accountName] = {
                liquid: liquid,
                balance: balanceFloat,
                accountName: accountName,
                pubKey: pubKey,
                cpuStake: cpuStake,
                netStake: netStake
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

var argParser = new ArgumentParser({
    version: '1.0.0',
    addHelp: true,
    description: 'Telos snapshot injection and validation'
});

argParser.addArgument(
    'http-endpoint',
    {
        help: 'HTTP Endpoint of the node'
    }
);

argParser.addArgument(
    'snapshot-input',
    {
        help: 'The path to the snapshot file to use'
    }
);

argParser.addArgument(
    '--inject',
    {
        defaultValue: "false",
        choices: ["true", "false"],
        help: 'Inject a snapshot, if true then --private-key must also be provided'
    }
);

argParser.addArgument(
    '--private-key',
    {
        help: 'Private key to use for signing account injection transactions'
    }
);

argParser.addArgument(
    '--validate',
    {
        defaultValue: "false",
        choices: ["true", "false"],
        help: 'Validate a snapshot'
    }
)

argParser.addArgument(
    '--validate-stake',
    {
        defaultValue: "false",
        choices: ["true", "false"],
        help: 'Validate the CPU/NET staking amounts'
    }
);

argParser.addArgument(
    '--write-csv',
    {
        help: 'WIP: Write a CSV with original snapshot broken into cpu/bw/liquid, if true then --snapshot-output must also be provided'
    }
);

argParser.addArgument(
    '--snapshot-output',
    {
        help: 'If --write-csv is passed, this will be the file to write to'
    }
);

argParser.addArgument(
    '--debug-accounts',
    {
        defaultValue: '[]',
        help: 'For debugging, a JSON array of accounts to debug thru the process'
    }
);

let args = argParser.parseArgs();

if (!args["http-endpoint"])
    throw new Error("Must provide an http endpoint for the node");

if (!args["snapshot-input"])
    throw new Error("Must provide a snapshot file to do injection");

if (args.inject == "true" && !args.private_key)
    throw new Error("Must provide a private key to do injection");

let debugAccounts = JSON.parse(args.debug_accounts);
console.log(debugAccounts);

let opts = {
    httpEndpoint: args["http-endpoint"],
    snapshotInput: args["snapshot-input"],
    inject: args.inject === "true",
    privateKey: args.private_key,
    validate: args.validate === "true",
    validateStake: args.validate_stake === "true",
    writeCsv: args.write_csv === "true",
    snapshotOutput: args.snapshot_output,
    debugAccounts: debugAccounts
};

(new Parser(opts).parse());
