Install jsdom **in this directory** — Node's ESM loader ignores `NODE_PATH`, so it must
resolve by directory walk-up:

    cd test && npm install && npm test

Or run them individually:

    node test.mjs           # matcher + similarity — 48 cases, no jsdom needed
    node dom-test.mjs       # detect → fill → mark in jsdom — 23 cases
    node pipeline-test.mjs  # detector output → server matcher, end to end
