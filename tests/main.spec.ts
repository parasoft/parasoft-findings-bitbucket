import * as sinon from 'sinon';
import * as main from '../src/main';
import * as runner from '../src/runner';
import {messages, messagesFormatter} from '../src/messages';
import {logger} from '../src/logger';

describe('parasoft-bitbucket/main', () => {
    describe('run', () => {
        const sandbox = sinon.createSandbox();
        let logInfo : sinon.SinonSpy;
        let logError : sinon.SinonSpy;
        let fakeStaticAnalysisParserRunner : sinon.SinonSpy;
        let customOption : runner.RunOptions;
        let runnerExitCode: number;

        beforeEach(() => {
            logInfo = sandbox.fake();
            sandbox.replace(logger, 'info', logInfo);
            logError = sandbox.fake();
            sandbox.replace(logger, 'error', logError);
            runnerExitCode = 0;
            customOption = {
                report: "D:/test/report.xml",
                parasoftToolOrJavaRootPath: "C:/Java"
            }
        });

        afterEach(() => {
            sandbox.restore();
            process.argv = [];
        });

        const setBitbucketEnv = () => {
            process.env.USER_EMAIL = 'user@mail.com';
            process.env.API_TOKEN = 'api-token';
            process.env.BITBUCKET_REPO_SLUG = 'repo';
            process.env.BITBUCKET_COMMIT = 'commit';
            process.env.BITBUCKET_WORKSPACE = 'workspace';
            process.env.BITBUCKET_CLONE_DIR = __dirname;
            process.env.BITBUCKET_API_URL = 'https://api.bitbucket.org/2.0/repositories';
        };

        const setUpFakeRunner = () => {
            fakeStaticAnalysisParserRunner = sandbox.fake.resolves({ exitCode: runnerExitCode });
            sandbox.replace(runner.StaticAnalysisParserRunner.prototype, 'run', fakeStaticAnalysisParserRunner);
        }

        it('Parse static analysis report with exit code 0', async () => {
            process.argv = ['node', 'dist/script.js', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            setBitbucketEnv();
            setUpFakeRunner();

            await main.run();

            sinon.assert.notCalled(logError);
            sinon.assert.calledWith(fakeStaticAnalysisParserRunner, customOption);
            sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.complete, runnerExitCode));
        });
    });
});