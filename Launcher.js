'use strict';

const request = require('request');
const eosjs = require('eosjs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const readline = require('readline');
const fetch = require('node-fetch');
const {TextDecoder, TextEncoder} = require('text-encoding');
const opts = require('./opts.js');

const ramAccountsSnapshot = 'ram_accounts.csv';
const telosBPAccountsSnapshot = 'initial_block_producers.csv';
const eosBPAccountsSnapshot = 'eos_bp_accounts.csv';
const tfrpAccountsSnapshot = 'tfrp_accounts.csv';
const tcrpAccountsSnapshot = 'tcrp_accounts.csv';
const tfvtAccountSnapshot = 'tfvtAccountSnapshot.csv';

const freeAccount = 'free.tf';
const freeAccountContractRamBytes = 512000;

const ramAdminAccount = 'ramadmin.tf';
const ramAdminLiquid = '40000.0000';
const ramAdminMemo = 'RAM Administrator';
const ramAdminBatchSize = '4000.0000';
const ramAdminBatchCount = 10;

const ramLaunchAccount = 'ramlaunch.tf';
const ramLaunchLiquid = '280000.0000';
const ramLaunchMemo = 'RAM Launch';
const ramLaunchBatchSize = '28000.0000';
const ramLaunchBatchCount = 10;

const tfRamadminRamdir = require('./tf.ramadmin.ramdir');
const tfActiveOwner = require('./tf.account.ao');
const tfSubAccountsActiveOwner = require('./tf.subaccounts.ao');
const ramAdminActive = require('./tf.ramadmin.active');
const ramAdminOwner = require('./tf.ramadmin.owner');
const ramLaunchActiveOwner = require('./tf.ramlaunch.ao');
const ramLaunchSellDel = require('./tf.ramlselldel');
const ramLaunchTransfer = require('./tf.ramltrns');

const endpoint = 'http://localhost:' + opts.apiPort;

const snapshotSha = 'master';
const genesisMemo = 'Genesis';
const tfAccountMemo = 'Telos Foundation';
const initVersion = 0;
const tokenSymbol = 'TLOS';
const maxSupply = '10000000000.0000';
const actionsPerTransaction = 600;
const injectionThreadCount = 1;
const maxTrxCpu = 4294967194;
const maxBlockCpu = 4294967295;

// TODO: make sure these values are the final values we want (cpu values are currently at max)
const globalValues = {
    'max_transaction_delay': 3888000,
    'min_transaction_cpu_usage': 100,
    'net_usage_leeway': 500,
    'context_free_discount_net_usage_den': 100,
    'max_transaction_net_usage': 524288,
    'context_free_discount_net_usage_num': 20,
    'max_transaction_lifetime': 3600,
    'deferred_trx_expiration_window': 600,
    'max_authority_depth': 6,
    'max_transaction_cpu_usage': 4294967194,
    'max_block_net_usage': 1048576,
    'target_block_net_usage_pct': 1000,
    'max_generated_transaction_count': 16,
    'max_inline_action_size': 4096,
    'target_block_cpu_usage_pct': 500,
    'base_per_transaction_net_usage': 12,
    'max_block_cpu_usage': 4294967295,
    'max_inline_action_depth': 4
};

const tokenIssuances = {
    'Genesis Snapshot': '178473249.3125',
    'Telos Foundation Issue': '6000000.0000',
    'Telos Founders Reward Pool Issue': '18000000.0000',
    'Telos Community Reward Pool Issue': '1000000.0000',
    'Exchange Pool': '140279973.0000',
    'Genesis Account RAM Issue': '25000.0000'
};

const tfAccounts = {
    'tf': '6000000.0000',
    'frp.tf': '18000000.0000',
    'crp.tf': '1000000.0000',
    'exrsrv.tf': '140279973.0000'
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
    'eosio.amend': 'eosio.amend',
    'eosio.arbitration': 'eosio.arb',
    'eosio.msig': 'eosio.msig',
    'eosio.saving': 'eosio.saving',
    'eosio.system': 'eosio',
    'eosio.token': 'eosio.token',
    'eosio.trail': 'eosio.trail',
    'eosio.wrap': 'eosio.wrap',
    'tfvt': 'tf',
    'telos.free': 'free.tf'
};

class Launcher {

    constructor() {
        this.eosjs = eosjs;
        this.jsonrpc = new this.eosjs.JsonRpc(endpoint, {fetch});
        this.contractsDir = opts.contractsDir.replace(/\/$/, '');
        this.teclos = opts.teclos + ' -u http://127.0.0.1:' + opts.apiPort;
        this.sigProvider = new this.eosjs.JsSignatureProvider([opts.eosioPrivate]);
        this.loadApi();
    }

    async launch() {
        this.log('Launch beginning...');
        await this.createEosioAccounts();
        await this.createAndIssueTokens();
        await this.pushContract('eosio.msig');

        await this.pushContract('eosio.amend');
        await this.setCodePermission(contracts['eosio.amend']);

        await this.pushContract('eosio.saving');
        await this.setCodePermission(contracts['eosio.saving']);
        await this.pushContract('eosio.wrap');
        await this.pushContract('eosio.system');

        this.loadApi();
        await this.initSystem();

        await this.setMsigPriv();
        await this.setWrapPriv();

        // This has to happen before TF accounts, the ABP accounts need to exist before the tf account permission can be set
        await this.createBPAccounts();

        await this.createTfAccounts();
        await this.setupFreeAccounts();

        // TODO: this once it's ready
        //await this.pushContract('tfvt');
        //await this.injectVotingTokens()

        await this.injectRewardPool();
        await this.injectCommunityPool();

        // END OF TF STUFFS
        // now that we've done everything we need to do with the tf accounts... set their permissions
        await this.setTfAccountPermissions();

        // TODO: merge key recovery CSV - planning to merge the recovered accounts with the snapshot and to pull both from github
        await this.injectGenesis();
        await this.ramSetup();

        // DO THIS LAST!!!
        await this.pushContract('eosio.trail');
        await this.setCodePermission(contracts['eosio.trail']);

        // TODO: figure out when we can run this
        //await this.regBallot();

        await this.pushContract('eosio.arbitration');

        // TODO: enable eosio.prods?
        this.log('Launch complete!');
    }

    loadApi() {
        this.api = this.getApi();
    }

    getApi() {
        return new this.eosjs.Api({
            rpc: this.jsonrpc,
            signatureProvider: this.sigProvider,
            textEncoder: new TextEncoder,
            textDecoder: new TextDecoder
        });
    }

    async test() {
        let accts = await this.getGenesisAccounts();
        this.log(accts);
    }

    async sleep(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async getSnapshotMapWithBalances(fileName, accountIndex, keyIndex, balanceIndex, skipSplit) {
        let contents = await this.getSnapshot(fileName);
        let snapMap = {};

        let firstLine = true;
        contents.split('\n').forEach(line => {
            if (firstLine) {
                firstLine = false;
                return;
            }
            let lineParts = line.split(',');
            if (lineParts.length < balanceIndex || lineParts.length < keyIndex || lineParts.length < accountIndex) {
                this.log(`Skipping line, it's too short: ${line}`);
                return;
            }

            let accountName = lineParts[accountIndex].trim();
            let pubKey = lineParts[keyIndex].trim();
            let balance = lineParts[balanceIndex].trim();
            let ramBytes = 4096;

            if (!accountName || ! pubKey || !balance) {
                this.log(`getSnapshotMap skipping line because it's missing name/key/balance: ${line}`);
                return;
            }

            if (pubKey.length != 53) {
                this.log(`getSnapshotMap skipping line because pubKey too short: ${line}`);
                return;
            }

            let split = skipSplit ? {balance} : this.splitBalance(balance);

            snapMap[accountName] = Object.assign({ramBytes, pubKey, accountName}, split);
        });

        return snapMap;
    }

    async getSnapshotMap(fileName, accountIndex, keyIndex) {
        let contents = await this.getSnapshot(fileName);
        let snapMap = {};

        let firstLine = true;
        contents.split('\n').forEach(line => {
            if (firstLine) {
                firstLine = false;
                return;
            }
            let lineParts = line.split(',');
            if (lineParts.length < 4)
                return;

            let accountName = lineParts[accountIndex].trim();
            let pubKey = lineParts[keyIndex].trim();

            if (!accountName || ! pubKey) {
                this.log(`getSnapshotMap skipping line because it's missing name/key: ${line}`);
                return;
            }

            snapMap[accountName] = pubKey;
        });

        return snapMap;
    }

    async getSnapshot(fileName) {
        return this.httpGet(`https://raw.githubusercontent.com/Telos-Foundation/snapshots/${snapshotSha}/${fileName}`);
    }

    async httpGet(url) {
        this.log(`Getting url ${url}`);
        return new Promise((resolve, reject) => {
            request(url, (error, response, body) => {
                if (error) {
                    this.log(`Failed to get ${url}, got ${response && response.statusCode || -1} code and error: ${error}`);
                    reject(error);
                }

                this.log(`Got url ${url}`);
                resolve(body);
            });
        });
    }

    async setGlobals(highCpu) {
        this.log(`Setting globals to ${highCpu ? 'high' : 'low'} cpu`);
        let globals = Object.assign({}, globalValues);
        if (highCpu) {
            globals.max_transaction_cpu_usage = maxTrxCpu;
            globals.max_block_cpu_usage = maxBlockCpu;
        }
        return this.sendActions([
            {
                account: 'eosio',
                name: 'setparams',
                authorization: [{
                    actor: 'eosio',
                    permission: 'active'
                }],
                data: {
                    params: globals
                }
            }
        ]);
    }

    async initSystem() {
        this.log('Initializing system');
        return this.sendActions([
            {
                account: 'eosio',
                name: 'init',
                authorization: [{
                    actor: 'eosio',
                    permission: 'active',
                }],
                data: {
                    version: initVersion,
                    core: `4,${tokenSymbol}`
                }
            }
        ]);
    }

    async createBPAccounts() {
        this.log('Creating Telos BP Accounts');
        let telosBPAccounts = await this.getSnapshotMap(telosBPAccountsSnapshot, 2, 3);
        let eosBPAccounts = await this.getSnapshotMap(eosBPAccountsSnapshot, 1, 2);

        for (let accountName in telosBPAccounts) {
            if (eosBPAccounts.hasOwnProperty(accountName)) {
                delete eosBPAccounts[accountName];
                this.log(`Found duplicate BP account from EOS that's in the telos list: ${accountName}, will use Telos key and ignore one from EOS`);
            }

            this.log(`Creating Telos BP account ${accountName} with pubkey ${telosBPAccounts[accountName]}`);
            await this.createAccount(accountName, telosBPAccounts[accountName], 4096, 1, 1, 0, 'Founding BP');
        }

        for (let accountName in eosBPAccounts) {
            this.log(`Creating BP account for EOS BP ${accountName} with pubkey ${eosBPAccounts[accountName]}`);
            await this.createAccount(accountName, eosBPAccounts[accountName], 4096, 1, 1, 0, 'Genesis BP');
        }
    }

    async injectRewardPool() {
        this.log('Injecting founders rewards accounts');
        let tfrpAccounts = await this.getSnapshotMapWithBalances(tfrpAccountsSnapshot, 0, 1, 2);
        for (let accountName in tfrpAccounts) {
            this.log(`Creating TFRP account ${accountName}`);
            await this.sendActions(this.getAccountActions(tfrpAccounts[accountName], 'TFRP'));
        }
    }

    async injectCommunityPool() {
        this.log('Injecting community rewards accounts');
        let tfrpAccounts = await this.getSnapshotMapWithBalances(tcrpAccountsSnapshot, 0, 1, 2);
        for (let accountName in tfrpAccounts) {
            this.log(`Creating TCRP account ${accountName}`);
            await this.sendActions(this.getAccountActions(tfrpAccounts[accountName], 'TCRP'));
        }
    }

    async injectVotingTokens() {
        this.log('Injecting voting token accounts');
        let tfvtAccounts = await this.getSnapshotMapWithBalances(tfvtAccountSnapshot, 0, 1, 2, true);
        for (let accountName in tfvtAccounts) {
            this.log(`Creating TFVT account ${accountName}`);
            let acct = tfvtAccounts[accountName];
            this.createAccount(accountName, acct.pubKey, 4096, 8, 2, 0, 'TFVT');
            this.issueVotingToken(accountName, acct.balance);
        }
    }

    async createTfAccounts() {
        for (let accountName in tfAccounts) {
            await this.createAccount(accountName, opts.eosioPub, 4096, 8, 2, parseFloat(tfAccounts[accountName], 10), tfAccountMemo);
        }

        this.log(`Creating ${ramAdminAccount} and ${ramLaunchAccount}`);
        await this.createAccount(ramAdminAccount, opts.eosioPub, 8192, 1, 1, 0, 0);
        await this.createAccount(ramLaunchAccount, opts.eosioPub, 8192, 1, 1, 0, 0);
        this.log(`Transfering to  ${ramAdminAccount} and ${ramLaunchAccount}`);
        await this.sendActions([
            {
                account: 'eosio.token',
                name: 'transfer',
                authorization: [{
                    actor: 'tf',
                    permission: 'active',
                }],
                data: {
                    from: 'tf',
                    to: ramAdminAccount,
                    quantity: `${ramAdminLiquid} ${tokenSymbol}`,
                    memo: ramAdminMemo
                }
            },
            {
                account: 'eosio.token',
                name: 'transfer',
                authorization: [{
                    actor: 'tf',
                    permission: 'active',
                }],
                data: {
                    from: 'tf',
                    to: ramLaunchAccount,
                    quantity: `${ramLaunchLiquid} ${tokenSymbol}`,
                    memo: ramLaunchMemo
                }
            }
        ]);
    }

    async setTfAccountPermissions() {
        this.log('Setting permissions for tf accounts');
        await this.setAccountPermission('tf', 'owner', 'active', 'owner', tfActiveOwner);
        await this.setAccountPermission('tf', 'owner', 'owner', '', tfActiveOwner);

        await this.setAccountPermission('frp.tf', 'owner', 'active', 'owner', tfSubAccountsActiveOwner);
        await this.setAccountPermission('frp.tf', 'owner', 'owner', '', tfSubAccountsActiveOwner);

        await this.setAccountPermission('crp.tf', 'owner', 'active', 'owner', tfSubAccountsActiveOwner);
        await this.setAccountPermission('crp.tf', 'owner', 'owner', '', tfSubAccountsActiveOwner);

        // TODO: Does exrsrv control go to prods or tf?
        await this.setAccountPermission('exrsrv.tf', 'owner', 'active', 'owner', tfSubAccountsActiveOwner);
        await this.setAccountPermission('exrsrv.tf', 'owner', 'owner', '', tfSubAccountsActiveOwner);
    }

    async setupFreeAccounts() {
        this.log(`Creating ${freeAccount} account`);
        await this.createAccount(freeAccount, opts.eosioPub, freeAccountContractRamBytes, 8, 2, 0, tfAccountMemo);
        await this.pushContract('telos.free');
        await this.setCodePermission(contracts['telos.free']);
    }

    async createAccount(name, pubKey, ramBytes, cpu, net, transfer, memo) {
        return this.sendActions(this.getAccountActions({
            accountName: name,
            pubKey: pubKey,
            ramBytes: ramBytes,
            cpuStake: cpu,
            netStake: net,
            liquid: transfer
        }, memo));
    }

    async createEosioAccounts() {
        this.log('Creating eosio accounts...');
        for (let i = 0; i < eosioAccounts.length; i++)
            await this.createSystemAccount(eosioAccounts[i]);

        this.log('eosio accounts created');
    }

    async setCodePermission(accountName) {
        return this.setAccountPermission(accountName, 'active', 'active', 'owner', {
            'threshold': 1,
            'keys': [],
            'waits': [],
            'accounts': [{
                'permission': {'actor': 'eosio', 'permission': 'active'},
                'weight': 1
            }, {
                'permission': {'actor': accountName, 'permission': 'eosio.code'},
                'weight': 1
            }]
        });
    }

    async setAccountPermission(accountName, accountPermission, targetPermission, parent, auth) {
        this.log(`Setting ${targetPermission} permission for ${accountName}`);
        return this.sendActions([
            {
                account: 'eosio',
                name: 'updateauth',
                authorization: [{
                    actor: accountName,
                    permission: accountPermission,
                }],
                data: {
                    account: accountName,
                    permission: targetPermission,
                    parent: parent,
                    auth: auth
                }
            }
        ]);
    }

    async ramSetup() {
        await this.createRamAccounts();

        // Doing ram buys before setting permissions
        await this.buyTfRamLaunch();
        await this.buyTfRamAdmin();

        await this.setupRamPermissions();
    }

    async createRamAccounts() {
        let ramAccounts = await this.getSnapshotMap(ramAccountsSnapshot, 2, 3);

        for (let accountName in ramAccounts) {
            this.log(`Creating ram account ${accountName} with pubkey ${ramAccounts[accountName]}`);
            await this.createAccount(accountName, ramAccounts[accountName], 8192, 1, 1, 0, 0);
        }
    }

    async setupRamPermissions() {
        this.log('Setting up ram permissions...');
        await this.setRamLaunchPermissions();
        await this.setRamAdminPermissions();
    }

    async setRamLaunchPermissions() {
        await this.setAccountPermission(ramLaunchAccount, 'active', 'transfer', 'active', ramLaunchTransfer);
        await this.setAccountPermission(ramLaunchAccount, 'active', 'selldel', 'active', ramLaunchSellDel);
        await this.setActionPermission(ramLaunchAccount, 'active', ramLaunchAccount, 'eosio.token', 'transfer', 'transfer');
        await this.setActionPermission(ramLaunchAccount, 'active', ramLaunchAccount, 'eosio', 'delegatebw', 'selldel');
        await this.setActionPermission(ramLaunchAccount, 'active', ramLaunchAccount, 'eosio', 'undelegatebw', 'selldel');
        await this.setActionPermission(ramLaunchAccount, 'active', ramLaunchAccount, 'eosio', 'sellram', 'selldel');
        await this.setAccountPermission(ramLaunchAccount, 'owner', 'active', 'owner', ramLaunchActiveOwner);
        await this.setAccountPermission(ramLaunchAccount, 'owner', 'owner', '', ramLaunchActiveOwner);
    }

    async setRamAdminPermissions() {
        await this.setAccountPermission(ramAdminAccount, 'active', 'ramdir', 'active', tfRamadminRamdir);
        await this.setActionPermission(ramAdminAccount, 'active', ramAdminAccount, 'eosio', 'delegatebw', 'ramdir');
        await this.setActionPermission(ramAdminAccount, 'active', ramAdminAccount, 'eosio', 'undelegatebw', 'ramdir');
        await this.setActionPermission(ramAdminAccount, 'active', ramAdminAccount, 'eosio', 'buyram', 'ramdir');
        await this.setActionPermission(ramAdminAccount, 'active', ramAdminAccount, 'eosio', 'sellram', 'ramdir');
        await this.setAccountPermission(ramAdminAccount, 'owner', 'active', 'owner', ramAdminActive);
        await this.setAccountPermission(ramAdminAccount, 'owner', 'owner', '', ramAdminOwner);
    }

    async buyTfRamLaunch() {
        return this.buyRamBatches(ramLaunchBatchCount, ramLaunchBatchSize, ramLaunchAccount);
    }

    async buyTfRamAdmin() {
        return this.buyRamBatches(ramAdminBatchCount, ramAdminBatchSize, ramAdminAccount);
    }

    // THIS ASSUMES THE ACCOUNT IS STILL USING EOSIO KEY
    async buyRamBatches(batchCount, batchSize, accountName) {
        let count = 0;

        while (++count <= batchCount) {
            this.log(`Buying batch ${count} for ${accountName} of ${batchSize} ${tokenSymbol}`);
            await this.sendActions([{
                account: 'eosio',
                name: 'buyram',
                authorization: [{
                    actor: accountName,
                    permission: 'active',
                }],
                data: {
                    payer: accountName,
                    receiver: accountName,
                    quant: `${batchSize} ${tokenSymbol}`
                }
            }]);

            // Sleep so we don't get complaints about the same action in a block.... could also use nonce
            await this.sleep(1000);
        }
    }


    /*
         [[eosio::action]]
         void linkauth(  ignore<name>    account, - account who needs the permission ignore<name>    code, - contract account
                         ignore<name>    type, - action name
                         ignore<name>    requirement  - name of new permission
    */
    async setActionPermission(authAccount, authPermission, targetAccount, actionContract, actionName, newPermission) {
        return this.sendActions([
            {
                account: 'eosio',
                name: 'linkauth',
                authorization: [{
                    actor: authAccount,
                    permission: authPermission
                }],
                data: {
                    account: targetAccount,
                    code: actionContract,
                    type: actionName,
                    requirement: newPermission
                }
            }
        ]);
    }

    async injectGenesis() {
        this.log('Getting genesis accounts...');
        let genesisAccounts = await this.getGenesisAccounts();
        await this.setGlobals(true);
        await this.injectAccounts(genesisAccounts);
        await this.setGlobals(false);
    }

    async injectAccounts(accounts) {
        this.log('Injecting accounts...');
        this.accountInjectionCount = 0;
        let actions = [];
        let actionChunks = [];
        for (let accountName in accounts) {
            this.accountInjectionCount++;

            if (this.accountInjectionCount % 10000 === 0)
                this.log(`Created ${this.accountInjectionCount} account promises`);

            let account = accounts[accountName];
            actions = actions.concat(this.getAccountActions(account, genesisMemo));
            if (actions.length >= actionsPerTransaction) {
                actionChunks.push(actions);
                actions = [];
            }
        }

        if (actions.length)
            actionChunks.push(actions);

        let thisLauncher = this;

        async function sendWorker() {
            while (actionChunks.length) {
                if (actionChunks.length % 10 === 0)
                    thisLauncher.log(`${actionChunks.length} action chunks left`);

                await thisLauncher.sendActions(actionChunks.shift());
            }
            /*
            if (actionChunks.length % 10 === 0)
                thisLauncher.log(actionChunks.length + " action chunks left");

            if (actionChunks.length) {
                await thisLauncher.sendActions(actionChunks.shift());
                thisLauncher.log("Done sending actions in worker, recursing");
                await sendWorker();
            }
            */
        }

        let threads = [];
        this.log(`Starting ${injectionThreadCount} injection "workers"`);
        this.log(`Will be injecting ${actionChunks.length} batches of actions`);
        for (let i = 0; i < injectionThreadCount; i++)
            threads.push(sendWorker());

        await Promise.all(threads);
        this.log(`Done injecting`);
    }

    splitBalance(balance) {
        let liquid;
        if (balance <= 3)
            liquid = .1;
        else if (balance > 3 && balance <= 11)
            liquid = 2;
        else
            liquid = 10;

        let remainder = this.forcePrecision(balance - liquid);
        let cpuStake = this.forcePrecision(remainder / 2);
        let netStake = this.forcePrecision(remainder - cpuStake);

        return {
            liquid,
            remainder,
            cpuStake,
            netStake
        };
    }

    async getGenesisAccounts() {
        let _this = this;
        return new Promise(async function(resolve, reject) {
            let accounts = {};
            let snapMeta = {};
            let genesis = await _this.getSnapshot('tlos_genesis_snapshot.csv');
            genesis = genesis.split('\n');
            for (let i = 1; i < genesis.length; i++) {
                let line = genesis[i];
                //await _this.readCsv('./snapshot.csv', function(line) {
                let parts = line.split(',');
                let accountName = parts[2];
                let pubKey = parts[3];
                let balance = parts[4];

                snapMeta.account_count++;
                let balanceFloat = parseFloat(balance);
                snapMeta.total_balance += balanceFloat;

                let split = _this.splitBalance(balance);

                if (_this.debugAccounts && _this.debugAccounts.indexOf(accountName) > -1) {
                    _this.log(`Account ${accountName} =========`);
                    _this.log(`balance: ${balance}`);
                    _this.log(`remainder: ${split.remainder}`);
                    _this.log(`liquid: ${split.liquid}`);
                    _this.log(`cpuStake: ${split.cpuStake}`);
                    _this.log(`netStake: ${split.netStake}`);
                }

                accounts[accountName] = {
                    liquid: split.liquid,
                    balance: balanceFloat,
                    accountName: accountName,
                    pubKey: pubKey,
                    cpuStake: split.cpuStake,
                    netStake: split.netStake,
                    ramBytes: 4096
                };
            }
            //});

            resolve(accounts);
        });
    }

    async setMsigPriv() {
        return this.setAccountPriv('eosio.msig');
    }

    async setWrapPriv() {
        return this.setAccountPriv('eosio.wrap');
    }

    async setAccountPriv(accountName) {
        this.log(`Making ${accountName} a priviledged account`);
        return this.sendActions([
            {
                account: 'eosio',
                name: 'setpriv',
                authorization: [{
                    actor: 'eosio',
                    permission: 'active',
                }],
                data: {
                    account: accountName,
                    is_priv: 1
                }
            }
        ]);
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
                issuer: 'eosio',
                maximum_supply: `${maxSupply} ${tokenSymbol}`
            }
        }];
        Object.keys(tokenIssuances).forEach(memo => {
            actions.push({
                account: 'eosio.token',
                name: 'issue',
                authorization: [{
                    actor: 'eosio',
                    permission: 'active',
                }],
                data: {
                    to: 'eosio',
                    quantity: `${tokenIssuances[memo]} ${tokenSymbol}`,
                    memo: memo
                }
            });
        });

        await this.sendActions(actions);
    }

    async sendActions(actions) {
        return this.api.transact({
            actions: actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
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
                bytes: acct.ramBytes,
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
                stake_net_quantity: `${acct.netStake.toFixed(4)} ${tokenSymbol}`,
                stake_cpu_quantity: `${acct.cpuStake.toFixed(4)} ${tokenSymbol}`,
                transfer: true,
            }
        }];

        if (acct.liquid)
            actions.push({
                account: 'eosio.token',
                name: 'transfer',
                authorization: [{
                    actor: 'eosio',
                    permission: 'active',
                }],
                data: {
                    from: 'eosio',
                    to: accountName,
                    quantity: `${acct.liquid.toFixed(4)} ${tokenSymbol}`,
                    memo: memo ? memo : `${tokenSymbol} Genesis`
                }
            });

        return actions;
    }

    async createSystemAccount(accountName) {
        this.log('creating system account ' + accountName);
        return this.sendActions([{
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
                    keys: [],
                    accounts: [{
                        permission: {
                            actor: 'eosio',
                            permission: 'active'
                        },
                        weight: 1
                    }],
                    waits: []
                },
                active: {
                    threshold: 1,
                    keys: [],
                    accounts: [{
                        permission: {
                            actor: 'eosio',
                            permission: 'active'
                        },
                        weight: 1
                    }],
                    waits: []
                },
            },
        }]);
    }

    async pushContract(name) {
        await this.unlockWallet();
        let contractDir = `${this.contractsDir}/build/${name}`;
        //let wasm = contractDir + name + '.wasm';
        //let abi = contractDir + name + '.abi';
        await this.runTeclos(`set contract ${contracts[name]} ${contractDir}`);
    }

    async unlockWallet() {
        try {
            await this.runTeclos(`wallet unlock -n ${opts.walletName} --password ${opts.walletPassword}`);
        } catch (e) {
            // If it's already unlocked then it'll throw an error, no big deal, let's not break over it
        }
    }

    async runTeclos(command) {
        const {stdout, stderr} = await exec(this.teclos + ' ' + command);
        this.log(`Result of "${command}":\n ${stdout}\n`);
    }

    forcePrecision(val) {
        return parseFloat(parseFloat(val, 10).toFixed(4), 10);
    }

    log(message) {
        console.log(`${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${message}`);
    }
}

module.exports = Launcher;
