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
const tfvtAccountSnapshot = 'tfvt_accounts.csv';

const tfAccountContractRamBytes = 1024000;

const frpTfAccountTransferRamBytes = 128000;

const freeAccount = 'free.tf';
const freeAccountContractRamBytes = 512000;

//const abpAccounts = ['caleosblocks', 'kainosblkpro', 'blindblocart', 'tlsvenezuela', 'eosbarcelona', 'eosmetaliobp'];
const abpAccounts = [];
const abpMsigRamAmount = 1024000;

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

const eosioActiveAuth = require('./eosioActiveAuthority');

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
    'max_transaction_cpu_usage': 150000,
    'max_block_net_usage': 1048576,
    'target_block_net_usage_pct': 1000,
    'max_generated_transaction_count': 16,
    'max_inline_action_size': 4096,
    'target_block_cpu_usage_pct': 500,
    'base_per_transaction_net_usage': 12,
    'max_block_cpu_usage': 200000,
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
    'telos.tfvt': 'tf',
    'telos.free': 'free.tf'
};

const trailVoteTokenSettings = {
    'is_destructible': false,
    'is_proxyable': false,
    'is_burnable': false,
    'is_seizable': false,
    'is_max_mutable': true,
    'is_transferable': false,
    'is_recastable': true,
    'is_initialized': false,
    'counterbal_decay_rate': 300,
    'lock_after_initialize': true
};

const trailInitSettingsData = {
    'publisher': 'eosio.trail',
    'token_symbol': '4,VOTE',
    'new_settings': trailVoteTokenSettings
};

const regVoteTokenData = {
    'max_supply': '10000000000 VOTE',
    'publisher': 'eosio.trail',
    'info_url': ''
};

const arbSetConfig = {
    'max_elected_arbs': 20,
    'election_duration': 300,
    'start_election': 300,
    'arbitrator_term_length': 300,
    'fees': [1000000, 2000000, 3000000]
};

const wpsSetEnv = {
    'new_environment': {
        'publisher': 'eosio.saving',
        'cycle_duration': 2500000,
        'fee_percentage': 3,
        'fee_min': 50000,
        'start_delay': 864000000,
        'threshold_pass_voters': 5,
        'threshold_pass_votes': 50,
        'threshold_fee_voters': 4,
        'threshold_fee_votes': 20
    }
};

const amendSetEnv = {
    'new_environment': {
        'publisher': 'eosio.amend',
        'expiration_length': 2500000,
        'fee': 1000000,
        'start_delay': 864000000,
        'threshold_pass_voters': 5,
        'threshold_pass_votes': 66.67,
        'threshold_fee_voters': 4,
        'threshold_fee_votes': 25
    }
};

const tfvtSetConfig = {
    'publisher': 'tf',
    'new_config': {
        'publisher': 'tf',
        'max_board_seats': 12,
        'open_seats': 12,
        'open_election_id': 0,
        'holder_quorum_divisor': 5,
        'board_quorum_divisor': 2,
        'issue_duration': 2000000,
        'start_delay': 1200,
        'leaderboard_duration': 2000000,
        'election_frequency': 14515200,
        'last_board_election_time': 0,
        'is_active_election': false
    }
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


        await this.pushContract('eosio.wrap');
        await this.pushContract('eosio.system');

        this.loadApi();
        await this.initSystem();
        
        // Start with the globals from this script, override what is in genesis.json
        await this.setGlobals(false);
        
        await this.setMsigPriv();
        await this.setWrapPriv();

        // This has to happen before TF accounts, the ABP accounts need to exist before the tf account permission can be set
        await this.createBPAccounts();

        await this.createTfAccounts();
        await this.setupFreeAccounts();

        await this.injectRewardPool();
        await this.injectCommunityPool();

        // END OF TF STUFFS
        // now that we've done everything we need to do with the tf accounts... set their permissions
        await this.setTfSubAccountPermissions();

        await this.injectGenesis();
        await this.ramSetup();

        // trail->wps->amend->arbitration->tfvt
        // DO THIS LAST!!!
        await this.pushContract('eosio.trail');
        await this.setCodePermission(contracts['eosio.trail']);
        await this.setupTrailService();

        await this.pushContract('eosio.saving');
        await this.setCodePermission(contracts['eosio.saving']);
        await this.setupWps();

        await this.pushContract('eosio.amend');
        await this.setCodePermission(contracts['eosio.amend']);
        await this.setupAmend();

        await this.pushContract('eosio.arbitration');
        await this.setCodePermission(contracts['eosio.arbitration']);
        await this.setCodePermission(contracts['eosio.arbitration'], true);
        await this.setupArbitration();

        await this.pushContract('telos.tfvt');
        await this.setupTfvt();
        await this.injectVotingTokens();
//        await this.setTfAccountPermissions();

        // TODO: deferred actions for arbitration and tf board election to start just before activation
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

            let accountName = lineParts[accountIndex].trim().toLowerCase();
            let pubKey = lineParts[keyIndex].trim();
            let balance = lineParts[balanceIndex].trim();
            let ramBytes = 4096;

            if (!accountName || !pubKey || !balance) {
                this.log(`getSnapshotMap skipping line because it's missing name/key/balance: ${line}`);
                return;
            }

            if (pubKey.length != 53) {
                this.log(`getSnapshotMap skipping line because pubKey too short: ${line}`);
                return;
            }

            if (accountName.length > 12) {
                this.log(`getSnapshotMap skipping line because accountName is too long: ${accountName}`);
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

            let accountName = lineParts[accountIndex].trim().toLowerCase();
            let pubKey = lineParts[keyIndex].trim();

            if (!accountName || !pubKey) {
                this.log(`getSnapshotMap skipping line because it's missing name/key: ${line}`);
                return;
            }

            if (accountName.length > 12) {
                this.log(`getSnapshotMap skipping because account name is too long: ${line}`);
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

    async setupTrailService() {
        //teclos push action eosio.trail regtoken '["10000000000 VOTE", "eosio.trail", ""]' -p eosio
        this.log('Setting up trail service');
        return this.sendActions([
            {
                account: 'eosio.trail',
                name: 'regtoken',
                authorization: [{
                    actor: 'eosio.trail',
                    permission: 'active',
                }],
                data: regVoteTokenData
            },
            {
                account: 'eosio.trail',
                name: 'initsettings',
                authorization: [{
                    actor: 'eosio.trail',
                    permission: 'active',
                }],
                data: trailInitSettingsData
            }
        ]);
    }

    async setupArbitration() {
        this.log('Setting up arbitration');
        return this.sendActions([
            {
                account: 'eosio.arb',
                name: 'setconfig',
                authorization: [{
                    actor: 'eosio',
                    permission: 'active',
                }],
                data: arbSetConfig
            }
        ]);
    }

    async setupWps() {
        this.log('Setting up WPS');
        return this.sendActions([
            {
                account: 'eosio.saving',
                name: 'setenv',
                authorization: [{
                    actor: 'eosio.saving',
                    permission: 'active',
                }],
                data: wpsSetEnv
            }
        ]);
    }

    async setupAmend() {
        this.log('Setting up amend');
        return this.sendActions([
            {
                account: 'eosio.amend',
                name: 'setenv',
                authorization: [{
                    actor: 'eosio.amend',
                    permission: 'active',
                }],
                data: amendSetEnv
            }
        ]);
    }

    async setupTfvt() {
        this.log('Setting up tfvt');
        await this.setCodePermission('tf');
        return this.sendActions([
            {
                account: 'tf',
                name: 'setconfig',
                authorization: [{
                    actor: 'tf',
                    permission: 'active',
                }],
                data: tfvtSetConfig
            },{
                account: 'tf',
                name: 'inittfvt',
                authorization: [{
                    actor: 'tf',
                    permission: 'active',
                }],
                data: {
                    initial_info_link: ''
                }
            },{
                account: 'tf',
                name: 'inittfboard',
                authorization: [{
                    actor: 'tf',
                    permission: 'active',
                }],
                data: {
                    initial_info_link: ''
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
            await this.createAccount(accountName, telosBPAccounts[accountName], abpAccounts.indexOf(accountName) > -1 ? abpMsigRamAmount : 4096, 1, 1, 0, 'Founding BP');
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
            await this.sendActions(this.getAccountActions(tfrpAccounts[accountName], 'TFRP', 'frp.tf'));
        }
    }

    async injectCommunityPool() {
        this.log('Injecting community rewards accounts');
        let tcrpAccounts = await this.getSnapshotMapWithBalances(tcrpAccountsSnapshot, 0, 1, 2);
        for (let accountName in tcrpAccounts) {
            this.log(`Creating TCRP account ${accountName}`);
            tcrpAccounts[accountName].cpuStake = .9;
            tcrpAccounts[accountName].netStake = .1;
            tcrpAccounts[accountName].liquid = 0;
            await this.sendActions(this.getAccountActions(tcrpAccounts[accountName], 'TCRP', 'crp.tf'));
        }
    }

    async injectVotingTokens() {
        this.log('Injecting voting token accounts');
        let tfvtAccounts = await this.getSnapshotMapWithBalances(tfvtAccountSnapshot, 2, 3, 4, true);
        for (let accountName in tfvtAccounts) {
            this.log(`Creating TFVT account ${accountName}`);
            let acct = tfvtAccounts[accountName];
            await this.createAccount(accountName, acct.pubKey, 4096, 8, 2, 0, 'TFVT');
            await this.issueVotingToken(accountName, acct.balance);
        }
    }

    async issueVotingToken(accountName, accountBalance) {
        return this.sendActions([
            {
                account: 'eosio.trail',
                name: 'issuetoken',
                authorization: [{
                    actor: 'tf',
                    permission: 'active',
                }],
                data: {
                    'publisher': 'tf',
                    'recipient': accountName,
                    'tokens': `${accountBalance} TFVT`,
                    'airgrab': false
                }
            }
        ])
    }

    async createTfAccounts() {
        for (let accountName in tfAccounts) {
            this.log(`Creating Telos Foundation account: ${accountName}`);
            if (accountName == 'tf')
                await this.createAccount(accountName, opts.eosioPub, tfAccountContractRamBytes, 10, 10, parseFloat(tfAccounts[accountName], 10), tfAccountMemo);
            else if (accountName == 'frp.tf')
                await this.createAccount(accountName, opts.eosioPub, frpTfAccountTransferRamBytes, 10, 10, parseFloat(tfAccounts[accountName], 10), tfAccountMemo);
            else if (accountName == 'crp.tf')
                await this.createAccount(accountName, opts.eosioPub, 4096, 10, 10, parseFloat(tfAccounts[accountName], 10), tfAccountMemo);
            else
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
        await this.setAccountPermission('tf', 'owner', 'active', 'owner', tfActiveOwner);
        await this.setAccountPermission('tf', 'owner', 'owner', '', tfActiveOwner);
    }

    async setTfSubAccountPermissions() {
        this.log('Setting permissions for tf accounts');

        await this.setAccountPermission('frp.tf', 'owner', 'active', 'owner', tfSubAccountsActiveOwner);
        await this.setAccountPermission('frp.tf', 'owner', 'owner', '', tfSubAccountsActiveOwner);

        await this.setAccountPermission('crp.tf', 'owner', 'active', 'owner', tfSubAccountsActiveOwner);
        await this.setAccountPermission('crp.tf', 'owner', 'owner', '', tfSubAccountsActiveOwner);

        // eosio.prods owns this account, set active/owner to eosio@active
        await this.setAccountPermission('exrsrv.tf', 'owner', 'active', 'owner', eosioActiveAuth);
        await this.setAccountPermission('exrsrv.tf', 'owner', 'owner', '', eosioActiveAuth);

        // Only do owner, active is already setup
        await this.setAccountPermission(freeAccount, 'owner', 'owner', '', tfSubAccountsActiveOwner);
    }

    async setupFreeAccounts() {
        this.log(`Creating ${freeAccount} account`);
        await this.createAccount(freeAccount, opts.eosioPub, freeAccountContractRamBytes, 8, 2, 0, tfAccountMemo);
        await this.pushContract('telos.free');
        //await this.setCodePermission(contracts['telos.free']);
        return this.setAccountPermission(freeAccount, 'owner', 'active', 'owner', {
            'threshold': 1,
            'keys': [],
            'waits': [],
            'accounts': [{
                'permission': {'actor': freeAccount, 'permission': 'eosio.code'},
                'weight': 1
            }, {
                'permission': {'actor': 'tf', 'permission': 'active'},
                'weight': 1
            }]
        });
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

    async setCodePermission(accountName, setOwner = false) {
        return this.setAccountPermission(accountName, setOwner ? 'owner' : 'active', setOwner ? 'owner' : 'active', setOwner ? '' : 'owner', {
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
        await this.buyTfRamAdmin();
        await this.buyTfRamLaunch();
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

    async getRecoveredKeys() {
        let recovered = await this.getSnapshot('key_recovery.csv');
        let recoveredLines = recovered.split('\n');
        let keyMap = {};
        for (let i = 1; i < recoveredLines.length; i++) {
            let line = recoveredLines[i];
            let parts = line.split(',');
            if (parts.length < 2) {
                this.log(`Key recovery line invalid: ${line}`);
                continue;
            }

            let ethKey = parts[0].trim();
            let tlosKey = parts[1].trim();

            if (!ethKey || !tlosKey) {
                this.log(`Key recovery line had invalid keys: ${line}`);
                continue;
            }

            keyMap[ethKey.toLowerCase()] = tlosKey;
        }

        return keyMap;
    }

    async getGenesisAccounts() {
        let _this = this;
        return new Promise(async function(resolve, reject) {
            let accounts = {};
            let snapMeta = {};
            let genesis = await _this.getSnapshot('tlos_genesis_snapshot.csv');
            let recoveredMap = await _this.getRecoveredKeys();
            genesis = genesis.split('\n');
            for (let i = 1; i < genesis.length; i++) {
                let line = genesis[i];
                let parts = line.split(',');
                let ethKey = parts[1];
                let accountName = parts[2];
                let pubKey = parts[3];
                let balance = parts[4];

                if (!accountName || !pubKey || !balance) {
                    _this.log(`Skipping line from genesis snapshot, missing values ${line}`);
                    continue;
                }

                if (recoveredMap.hasOwnProperty(ethKey.toLowerCase())) {
                    _this.log(`Found recovered ethKey ${ethKey}, using ${recoveredMap[ethKey.toLowerCase()]} instead of ${pubKey} for account ${accountName} with balance ${balance}`);
                    pubKey = recoveredMap[ethKey.toLowerCase()];
                }

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

    getAccountActions(acct, memo, transferFrom = 'eosio') {
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
                actor: transferFrom,
                permission: 'active',
            }],
            data: {
                from: transferFrom,
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
                    actor: transferFrom,
                    permission: 'active',
                }],
                data: {
                    from: transferFrom,
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
                owner: eosioActiveAuth,
                active: eosioActiveAuth
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
