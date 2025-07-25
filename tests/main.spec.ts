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
                parasoftToolOrJavaRootPath: "C:/Java",
            }
        });

        afterEach(() => {
            sandbox.restore();
            process.argv = [];
        });

        const setUpFakeRunner = () => {
            fakeStaticAnalysisParserRunner = sandbox.fake.resolves({ exitCode: runnerExitCode });
            sandbox.replace(runner.StaticAnalysisParserRunner.prototype, 'run', fakeStaticAnalysisParserRunner);
            sandbox.stub(runner.StaticAnalysisParserRunner.prototype, 'getBitbucketEnvs' as any)
                .returns({API_TOKEN: "", USER_EMAIL: "", BITBUCKET_COMMIT: "", BITBUCKET_REPO_SLUG: "", BITBUCKET_WORKSPACE: "", BITBUCKET_CLONE_DIR: "", BITBUCKET_API_URL: ""});
        }

        it('Parse static analysis report with exit code 0', async () => {
            process.argv = ['node', 'dist/script.js', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            setUpFakeRunner();

            await main.run();

            sinon.assert.notCalled(logError);
            sinon.assert.calledWith(fakeStaticAnalysisParserRunner, customOption);
            sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.complete, runnerExitCode));
        });
    });
});