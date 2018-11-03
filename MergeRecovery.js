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
        this.snapshotInput = opts.snapshotInput;
        this.snapshotOutput = opts.snapshotOutput;
        this.recovered = opts.recovered;
        this.accounts = {};
        this.recoveredAccounts = {};
        this.snapMeta = {
            account_count: 0,
            recovered_count: 0,
            matched_count: 0
        };

        console.log("Writing to " + this.snapshotOutput);
        try {
            fs.unlinkSync(this.snapshotOutput);
        } catch (e) {
            console.warn(this.snapshotOutput + " did not yet exist");
        }

    }

    async parse() {
        await this.parseRecovered();
        await this.parseFile();
    }

    writeRow(writer, accountName) {
        let acct = this.accounts[accountName];
        if (!acct) {
            console.error("Couldn't get user object to write row: " + accountName);
        } else {
            writer.write(acct.id +
                "," + acct.ethKey +
                "," + acct.accountName +
                "," + acct.pubKey +
                "," + acct.balance + "\n"
            )
        }
    }

    async writeCsv() {
        const writer = fs.createWriteStream(this.snapshotOutput);
        for (let accountName in this.accounts)
            this.writeRow(writer, accountName);

        writer.end();
    }

    async parseRecovered() {
        let thisParser = this;
        return new Promise(function(resolve, reject) {
            console.log("Parsing recovered keys: " + thisParser.recovered);

            let rl = readline.createInterface({
                input: fs.createReadStream(thisParser.recovered),
                terminal: false
            });


            rl.on('line', async function(line) {
                let parts = line.split(',');
                let ethKey = parts[0];
                let pubKey = parts[1];

                thisParser.snapMeta.recovered_count++;

                thisParser.recoveredAccounts[ethKey.toLowerCase()] = {
                    ethKey: ethKey.toLowerCase(),
                    pubKey: pubKey
                };

            });

            rl.on('close', async function() {
                console.log("Found " + thisParser.snapMeta.recovered_count + " recovered accounts");
                resolve();
            });
        });
    }

    async parseFile() {
        console.log("Parsing: " + JSON.stringify(this.snapshotInput));

        let snapMeta = this.snapMeta;

        let accounts = {};

        let rl = readline.createInterface({
            input: fs.createReadStream(this.snapshotInput),
            terminal: false
        });

        let thisParser = this;

        rl.on('line', async function(line) {
            let parts = line.split(',');
            let id = parts[0];
            let ethKey = parts[1];
            let accountName = parts[2];
            let pubKey = parts[3];
            let balance = parts[4];

            snapMeta.account_count++;

            if (thisParser.recoveredAccounts.hasOwnProperty(ethKey.toLowerCase())) {
                console.log("Eth key " + ethKey + " recovered, replacing " + pubKey + " with " + thisParser.recoveredAccounts[ethKey].pubKey);
                pubKey = thisParser.recoveredAccounts[ethKey].pubKey;
                snapMeta.matched_count++;
            }

            accounts[accountName] = {
                id: id,
                ethKey: ethKey,
                balance: balance,
                accountName: accountName,
                pubKey: pubKey
            };

        });

        rl.on('close', async function() {
            thisParser.accounts = accounts;
            await thisParser.writeCsv();
            console.log("Account count: " + snapMeta.account_count);
            console.log("Matched count: " + snapMeta.matched_count);
        });
    }
}

var argParser = new ArgumentParser({
    version: '1.0.0',
    addHelp: true,
    description: 'Telos snapshot injection and validation'
});

argParser.addArgument(
    'snapshot-input',
    {
        help: 'The path to the snapshot file to use'
    }
);

argParser.addArgument(
    'recovered',
    {
        help: 'The 2 column csv file of key recovered accounts'
    }
)

argParser.addArgument(
    'snapshot-output',
    {
        help: 'If --write-csv is passed, this will be the file to write to'
    }
);



let args = argParser.parseArgs();

let opts = {
    snapshotInput: args["snapshot-input"],
    snapshotOutput: args["snapshot-output"],
    recovered: args.recovered
};

(new Parser(opts).parse());
