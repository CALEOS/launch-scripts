# launch-scripts

- For the ParseSnapshot.js file, you'll need a recent version of nodejs (latest ubuntu doesn't come with the latest nodejs by default)
- And then in the same directory as you'll run the script from, you'll want a file named snapshot.csv, without a header line
- In that same directory you'll also want to run `npm install readline eosjs@beta node-fetch text-encoding promise-parallel-throttle single-line-log argparse`

To survive injection with batch size of 600 actions per transaction you'll need `max-transaction-time = 100000` in your config.ini and for genesis.json `"max_block_cpu_usage": 50000000,` and `"max_transaction_cpu_usage": 5000000,`

The script has arguments, you can learn about them by calling `node ParseSnapshot.js -h` and you should see
```
node ParseSnapshot.js -h
usage: ParseSnapshot.js [-h] [-v] [--inject {true,false}]
                        [--private-key PRIVATE_KEY] [--validate {true,false}]
                        [--validate-stake {true,false}]
                        [--write-csv WRITE_CSV]
                        [--snapshot-output SNAPSHOT_OUTPUT]
                        [--debug-accounts DEBUG_ACCOUNTS]
                        http-endpoint snapshot-input

Telos snapshot injection and validation

Positional arguments:
  http-endpoint         HTTP Endpoint of the node
  snapshot-input        The path to the snapshot file to use

Optional arguments:
  -h, --help            Show this help message and exit.
  -v, --version         Show program's version number and exit.
  --inject {true,false}
                        Inject a snapshot, if true then --private-key must 
                        also be provided
  --private-key PRIVATE_KEY
                        Private key to use for signing account injection 
                        transactions
  --validate {true,false}
                        Validate a snapshot
  --validate-stake {true,false}
                        Validate the CPU/NET staking amounts
  --write-csv WRITE_CSV
                        WIP: Write a CSV with original snapshot broken into 
                        cpu/bw/liquid, if true then --snapshot-output must 
                        also be provided
  --snapshot-output SNAPSHOT_OUTPUT
                        If --write-csv is passed, this will be the file to 
                        write to
  --debug-accounts DEBUG_ACCOUNTS
                        For debugging, a JSON array of accounts to debug thru 
                        the process

```
