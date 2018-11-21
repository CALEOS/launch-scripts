'use strict'

const ArgumentParser = require('argparse').ArgumentParser;
const Parser = require('./Parser.js');

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

argParser.addArgument(
    '--debug',
    {
        defaultValue: 'false',
        help: 'Enable verbose debugging'
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

let opts = {
    httpEndpoint: args["http-endpoint"],
    snapshotInput: args["snapshot-input"],
    inject: args.inject === "true",
    privateKey: args.private_key,
    validate: args.validate === "true",
    validateStake: args.validate_stake === "true",
    writeCsv: args.write_csv === "true",
    snapshotOutput: args.snapshot_output,
    debugAccounts: debugAccounts,
    debug: args.debug === "true"
};

(new Parser(opts).parse());
