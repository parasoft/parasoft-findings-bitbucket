import * as main from '../src/main';

describe('parasoft-bitbucket/main', () => {
    it('run', () => {
        main.run().then(() => {
            // Do nothing, just ensure it runs without errors
        });
    });
});