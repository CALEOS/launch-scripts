/*
console.time('launch');
let Launcher = require("./Launcher");
let l = new Launcher();
l.launch();
console.time('launch');
*/
let SnapshotInject = require('./SnapshotInject')
let privateKey = "keyhere";

let opts = {
    httpEndpoint: "https://telos.caleos.io",
    //snapshotInput: "/Users/jesse/Downloads/6milsnap.txt",
    snapshotInput: "/Users/jesse/Downloads/6MSnapshotWithBalances.csv",
    inject: true,
    privateKey: privateKey,
    validate: false,
    validateStake: false,
    writeCsv: false,
    snapshotOutput: "~/telos/6milsnap.csv",
    debugAccounts: [],
    debug: true
};

(new SnapshotInject(opts).run());
