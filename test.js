/*
console.time('launch');
let Launcher = require("./Launcher");
let l = new Launcher();
l.launch();
console.time('launch');
*/
let SnapshotInject = require('./SnapshotInject')
let privateKey = "5JuZDeb21pFJB4hUjkBYmK4LANmNcf4SnzQTGovQdRPZ9d6K7bc";

let opts = {
    httpEndpoint: "https://127.0.0.1:8888",
    //snapshotInput: "/Users/jesse/Downloads/6milsnap.txt",
    snapshotInput: "/opt/launch-scripts/snapshots/12MSnapshotWithBalances.csv",
    inject: true,
    privateKey: privateKey,
    validate: false,
    validateStake: false,
    writeCsv: false,
    snapshotOutput: "~/telos/12milsnap.csv",
    debugAccounts: [],
    debug: true
};

(new SnapshotInject(opts).run());
