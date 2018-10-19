'use strict'
const fs = require('fs');
const readline = require('readline');
const eosjs = require('eosjs');
const fetch = require('node-fetch');
const Throttle = require('promise-parallel-throttle');
const logger = require('single-line-log');
const log = logger.stdout;


class Parser {

    constructor() {
        this.jsonrpc = new eosjs.Rpc.JsonRpc("http://127.0.0.1:9888", { fetch });
        this.filename = "./snapshot.csv";
        this.parsedFilename = "./snapshotParsed.csv";
        this.balancesChecked = 0;
        console.log("Writing to " + this.parsedFilename);
        this.accounts = {};

        /*
        // this is if we want to write out a modified CSV...
        try {
            fs.unlinkSync(this.parsedFilename);
        } catch (e) {
            console.error(e + " happened trying to delete " + this.parsedFilename);
        }
        */

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

    async getAccount(accountName) {
        let thisParser = this;

        let account = await this.jsonrpc.get_account(accountName).then(acct => {
            this.checkBalance(acct);
            return acct.account_name;
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

    async getAccounts() {
        const queue = Object.keys(this.accounts).map(account => () => this.getAccount(account));
        const completedQueue = await Throttle.all(queue, {
            maxInProgress: 2
        });
    }

    async parseFile() {
        console.log("Parsing: " + JSON.stringify(this.filename));

        let snapMeta = {
            account_count: 0,
            total_balance: 0.0
        };

        this.snapMeta = snapMeta;

        let accounts = {};

        let rl = readline.createInterface({
            input: fs.createReadStream(this.filename),
            terminal: false
        });

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

            let remainder = balance - liquid;
            let cpuStake = remainder / 2;
            let netStake = remainder - cpuStake;

            accounts[accountName] = {
                balance: balanceFloat,
                accountName: accountName,
                pubKey: pubKey,
                cpuStake: cpuStake,
                netStake: netStake
            };

        });

        let thisParser = this;
        rl.on('close', async function() {
            thisParser.accounts = accounts;
            await thisParser.getAccounts();
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

(new Parser().parse());
