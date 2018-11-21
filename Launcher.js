'use strict';

const eosjs = require('eosjs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const readline = require('readline');
const fetch = require('node-fetch');
const {TextDecoder, TextEncoder} = require('text-encoding');
const SnapshotHandler = require('./SnapshotHandler');
const opts = require('./opts.js');
const endpoint = 'http://localhost:' + opts.apiPort;

const tokenSymbol = 'TLOS';
const maxSupply = '10000000000.0000';

const tokenIssuances = {
    'Genesis Snapshot': '178473249.3125',
    'Telos Founders Reward Pool Issue': '18000000.0000',
    'Telos Community Reward Pool Issue': '1000000.0000',
    'Telos Foundation Issue': '6000000.0000',
    'Exchange Pool': '140279973.0000',
    'Genesis Account RAM Issue': '25000.0000'
};

const eosioAccounts = [
    'eosio.bpay',
    'eosio.vpay',
    'eosio.msig',
    'eosio.names',
    'eosio.ram',
    'eosio.ramfee',
    'eosio.saving',
    'eosio.stake',
    'eosio.token',
    'eosio.trail',
    'eosio.amend',
    'eosio.arb',
    'eosio.exrsrv',
    'eosio.bpadj',
    'eosio.wrap'
];

// contractDir: accountName
const contracts = {
    'eosio.system': 'eosio',
    'eosio.token': 'eosio.token',
    'eosio.msig': 'eosio.msig',
    'eosio.trail': 'eosio.trail',
    'eosio.amend': 'eosio.amend',
    'eosio.saving': 'eosio.saving',
    'eosio.wrap': 'eosio.wrap'
};

class Launcher {

    constructor() {
        this.eosjs = require('eosjs');
        this.jsonrpc = new this.eosjs.JsonRpc(endpoint, {fetch});
        this.contractsDir = opts.contractsDir.replace(/\/$/, '');
        this.teclos = opts.teclos + ' -u http://127.0.0.1:' + opts.apiPort;

        let sigProvider = new this.eosjs.JsSignatureProvider([opts.eosioPrivate]);
        this.api = new this.eosjs.Api({
            rpc: this.jsonrpc,
            signatureProvider: sigProvider,
            textEncoder: new TextEncoder,
            textDecoder: new TextDecoder
        });
    }

    async test() {
        let accts = await this.getGenesisAccounts();
        console.log(accts);
    }

    async launch() {
        console.log('Launch beginning...');
        await this.createEosioAccounts();
        await this.createAndIssueTokens();
        await this.pushContract('eosio.msig');
        await this.setMsigPriv();
        await this.pushContract('eosio.amend');
        await this.setCodePermission(contracts['eosio.amend']);
        await this.pushContract('eosio.saving');
        await this.setCodePermission(contracts['eosio.saving']);
        await this.pushContract('eosio.wrap');
        await this.pushContract('eosio.system');
        await this.injectGenesis();

        // DO THIS LAST!!!
        await this.pushContract('eosio.trail');
        await this.setCodePermission(contracts['eosio.trail']);
        await this.regBallot();
        console.log('Launch complete!');
    }

    async createEosioAccounts() {
        console.log('Creating eosio accounts...');
        let promises = [];
        for (let i = 0; i < eosioAccounts.length; i++) {
            promises.push(this.createSystemAccount(eosioAccounts[i]));
        }
        await Promise.all(promises);
        console.log('eosio accounts created');
    }

    async setCodePermission(accountName) {
        this.sendActions([
            {
                account: 'eosio',
                name: 'updateauth',
                authorization: [{
                    actor: accountName,
                    permission: 'active',
                }],
                data: {
                    account: accountName,
                    permission: 'active',
                    parent: 'owner',
                    auth: {
                        "threshold": 1,
                        "keys": [],
                        "waits": [],
                        "accounts": [{
                            "permission": {"actor": "eosio", "permission": "active"},
                            "weight": 1
                        }, {"permission": {"actor": accountName, "permission": "eosio.code"},
                            "weight": 1
                        }]
                    }
                }
            }

        ])
    }

    async injectGenesis() {
        console.log("Getting genesis accounts...");
        this.genesisAccounts = await this.getGenesisAccounts();
        console.log("Injecting genesis accounts...");
        await this.injectAccounts(this.genesisAccounts);
    }

    async injectAccounts(accounts) {
    }

    async getGenesisAccounts() {
        let _this = this;
        return new Promise(async function (resolve, reject) {
            let accounts = {};
            let snapMeta = {};
            await _this.readCsv('./snapshot.csv', function(line) {
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


                let remainder = _this.forcePrecision(balance - liquid);
                let cpuStake = _this.forcePrecision(remainder / 2);
                let netStake = _this.forcePrecision(remainder - cpuStake);

                if (_this.debugAccounts && _this.debugAccounts.indexOf(accountName) > -1) {
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

            resolve(accounts);
        });
    }

    async setMsigPriv() {
        this.sendActions([
            {
                account: 'eosio',
                name: 'setpriv',
                authorization: [{
                    actor: 'eosio',
                    permission: 'active',
                }],
                data: {
                    account: 'eosio.msig',
                    is_priv: 1
                }
            }
        ])
    }

    async regBallot() {
        this.sendActions([
            {
                account: 'eosio.trail',
                name: 'regballot',
                authorization: [{
                    actor: 'eosio.amend',
                    permission: 'active',
                }],
                data: {
                    publisher: 'eosio.amend'
                }
            }

        ])
    }

    async createAndIssueTokens() {
        await this.pushContract('eosio.token');
        let actions = [{
            account: 'eosio.token',
            name: 'create',
            authorization: [{
                actor: 'eosio.token',
                permission: 'active',
            }],
            data: {
                issuer: 'eosio.token',
                maximum_supply: '10000000000.0000 TLOS'
            }
        }];
        for (let memo in tokenIssuances) {
            actions.push({
                account: 'eosio.token',
                name: 'issue',
                authorization: [{
                    actor: 'eosio.token',
                    permission: 'active',
                }],
                data: {
                    to: 'eosio',
                    quantity: tokenIssuances[memo] + ' TLOS',
                    memo: memo
                }
            });
        }

        await this.sendActions(actions);
    }

    async sendActions(actions) {
        await this.api.transact({
            actions: actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        })
    }

    async readCsv(path, callback) {
        return new Promise(function(resolve, reject) {
            let rl = readline.createInterface({
                input: fs.createReadStream(path),
                terminal: false
            });

            rl.on('line', callback);
            rl.on('close', resolve);
        });
    }

    getAccountActions(acct, memo) {
        let accountName = acct.accountName;
        return [{
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
                        key: acct.pubKey,
                        weight: 1
                    }],
                    accounts: [],
                    waits: []
                },
                active: {
                    threshold: 1,
                    keys: [{
                        key: acct.pubKey,
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
                stake_net_quantity: acct.netStake.toFixed(4) + ' TLOS',
                stake_cpu_quantity: acct.cpuStake.toFixed(4) + ' TLOS',
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
                quantity: acct.liquid.toFixed(4) + ' TLOS',
                memo: memo ? memo : 'TLOS Genesis'
            }
        }];
    }

    async createSystemAccount(accountName) {
        console.log('creating account ' + accountName);
        await this.runTeclos('create account eosio ' + accountName + ' ' + opts.eosioPub);
    }

    async pushContract(name) {
        let contractDir = this.contractsDir + '/build/' + name;
        //let wasm = contractDir + name + '.wasm';
        //let abi = contractDir + name + '.abi';
        await this.runTeclos('set contract ' + contracts[name] + ' ' + contractDir);
    }

    async runTeclos(command) {
        const {stdout, stderr} = await exec(this.teclos + ' ' + command);
        console.log('Result of "' + command + '":\n' + stdout + '\n');
    }

    forcePrecision(val) {
        return parseFloat(parseFloat(val, 10).toFixed(4), 10);
    }

}

module.exports = Launcher;