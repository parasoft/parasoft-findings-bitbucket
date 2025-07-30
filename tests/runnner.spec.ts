import * as sinon from "sinon";
import {RunOptions, StaticAnalysisParserRunner} from "../src/runner";
import {messages, messagesFormatter} from '../src/messages';
import axios, {AxiosError, AxiosHeaders, AxiosResponse} from "axios";
import {logger} from "../src/logger";
import * as pt from 'path';
import * as cp from 'child_process';
import * as path from "node:path";
import * as fs from "node:fs";

describe('runnner', () => {
    describe('run', () => {
        let sandbox: sinon.SinonSandbox;
        // logger
        let logInfo: sinon.SinonSpy;
        let logError: sinon.SinonSpy;
        let logWarn: sinon.SinonSpy;

        beforeEach(() => {
            sandbox = sinon.createSandbox();
            logInfo = sandbox.fake();
            sandbox.replace(logger, 'info', logInfo);
            logError = sandbox.fake();
            sandbox.replace(logger, 'error', logError);
            logWarn = sandbox.fake();
            sandbox.replace(logger, 'warn', logWarn);
        });

        afterEach(() => {
            sandbox.restore();
        })

        it('no static analysis reports found', async () => {
            const put = sandbox.fake.resolves({status: 200, data: {}});
            sandbox.replace(axios, 'put', put);
            const runOptions: RunOptions = {
                report: './res/reports/SARIF.*', // no matching reports
                parasoftToolOrJavaRootPath: '',
            };

            try {
                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());
            } catch (error) {
                if (error instanceof Error) {
                    sinon.assert.match(error.message, messagesFormatter.format(messages.static_analysis_report_not_found, __dirname.replace(/\\/g, '/') + '/res/reports/SARIF.*'));
                    sinon.assert.calledWith(logInfo, (messagesFormatter.format(messages.finding_static_analysis_report_in_working_directory, __dirname)));
                    sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.skipping_unrecognized_report_file, path.join(__dirname, '/res/reports/SARIF.sarif')));
 
                    sinon.assert.notCalled(put);
                    return;
                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            }
            sinon.assert.fail("Expected error to be thrown but it was not.");
        });

        it('no Java execute file found in tool home', async () => {
            const put = sandbox.fake.resolves({status: 200, data: {}});
            sandbox.replace(axios, 'put', put);
            const runOptions: RunOptions = {
                report: pt.join(__dirname, '/res/reports/*.xml'),
                parasoftToolOrJavaRootPath: path.join(__dirname, '/res/toolRootPaths/nojava')
            };

            try {
                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());
            } catch (error) {
                if (error instanceof Error) {
                    sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.finding_static_analysis_report));
                    sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.skipping_unrecognized_report_file, pt.join(__dirname, '/res/reports/XML_COVERAGE.xml')));
                    sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.found_matching_file, pt.join(__dirname, '/res/reports/XML_STATIC.xml')));
                    sinon.assert.notCalled(put);
                    sinon.assert.match(error.message, messagesFormatter.format(messages.java_not_found_in_java_or_parasoft_tool_install_dir));
                    return;
                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            }
            sinon.assert.fail("Expected error to be thrown but it was not.");
        });

        it('no Java execute file found', async () => {
            const javahome = process.env.JAVA_HOME;
            try {
                delete process.env.JAVA_HOME;

                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const runOptions: RunOptions = {
                    report: __dirname + '/res/reports/*.xml'
                };

                try {
                    const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                    await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());
                } catch (error) {
                    if (error instanceof Error) {
                        sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.finding_static_analysis_report));
                        sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.skipping_unrecognized_report_file, pt.join(__dirname, '/res/reports/XML_COVERAGE.xml')));
                        sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.found_matching_file, pt.join(__dirname, '/res/reports/XML_STATIC.xml')));
                        sinon.assert.notCalled(put);
                        sinon.assert.match(error.message, messagesFormatter.format(messages.java_or_parasoft_tool_install_dir_not_found));
                        return;
                    }
                    sinon.assert.fail("Expected error to be thrown but it was not.");
                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            } finally {
                process.env.JAVA_HOME = javahome;
            }
        });

        describe('parse and upload static analysis result', () => {
            let runOptions: RunOptions;
            let joinStub: sinon.SinonStub;
            let reportPath: string;

            before(() => {
                const realJoin = pt.join;
                joinStub = sinon.stub(pt, 'join').callsFake((...args: string[]) => {
                    if (args.length >= 2) {
                        if (args[1] === 'SaxonHE12-2J/saxon-he-12.2.jar') {
                            return realJoin(__dirname.substring(0, __dirname.length - 'tests'.length), 'libs', ...args.slice(1));
                        }
                        if (args[1] === 'sarif.xsl') {
                            return realJoin(__dirname.substring(0, __dirname.length - 'tests'.length), 'res', ...args.slice(1));
                        }
                    }
                    return realJoin(...args);
                });
            })

            after(() => {
                joinStub.restore();
            });

            beforeEach(() => {
                reportPath = path.join(__dirname, '/res/reports/XML_STATIC')
                if (fs.existsSync(reportPath + '.sarif')) {
                    fs.rmSync(reportPath + '.sarif');
                }
                runOptions = {
                    report: reportPath + '.xml',
                    parasoftToolOrJavaRootPath: path.join(__dirname, '/res/toolRootPaths/toolHome')
                };
            })

            afterEach(() => {
                if (fs.existsSync(reportPath + '.sarif')) {
                    fs.rmSync(reportPath + '.sarif');
                }
            })

            it('parse and upload static analysis result normal', async () => {
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                const result = await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());

                sinon.assert.match(result.exitCode, 1);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.parsed_parasoft_static_analysis_report, 1552, path.join(__dirname, '/res/reports/XML_STATIC.xml')));
                sinon.assert.calledOnce(put);
                sinon.assert.callCount(post, 10);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.uploaded_parasoft_report_results, 'dotTEST', 1000));
            });

            it('parse and upload static analysis result normal - no violation', async () => {
                reportPath = path.join(__dirname, '/res/reports/report_no_violation');
                runOptions.report = reportPath + '.xml';
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                const result = await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());

                sinon.assert.match(result.exitCode, 0);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.parsed_parasoft_static_analysis_report, 0, path.join(__dirname, '/res/reports/report_no_violation.xml')));
                sinon.assert.notCalled(put);
                sinon.assert.notCalled(post);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messagesFormatter.format(messages.skip_static_analysis_report, runOptions.report)));
            });

            it('parse and upload static analysis result normal - less than 1000 violation', async () => {
                reportPath = path.join(__dirname, '/res/reports/dottest-report-202401');
                runOptions.report = reportPath + '.xml';
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                const result = await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());

                sinon.assert.match(result.exitCode, 1);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.parsed_parasoft_static_analysis_report, 42, path.join(__dirname, '/res/reports/dottest-report-202401.xml')));
                sinon.assert.calledOnce(put);
                sinon.assert.callCount(post, 1);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.uploaded_parasoft_report_results, 'dotTEST', 42));
            });

            it('parse and upload static analysis result normal - violation without id', async () => {
                reportPath = path.join(__dirname, '/res/reports/cpptest-pro-report-202301');
                runOptions.report = reportPath + '.xml';
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                const result = await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());

                sinon.assert.match(result.exitCode, 1);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.parsed_parasoft_static_analysis_report, 3145, path.join(__dirname, '/res/reports/cpptest-pro-report-202301.xml')));
                sinon.assert.calledOnce(put);
                sinon.assert.callCount(post, 10);
                sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.uploaded_parasoft_report_results, 'C++test', 1000));
            });

            it('not valid Static Analysis report', async () => {
                reportPath = path.join(__dirname, '/res/reports/invalid_report');
                runOptions.report = reportPath + '.xml';
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                try {
                    const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                    await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());
                } catch (error) {
                    if (error instanceof Error) {
                        sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.skipping_unrecognized_report_file, runOptions.report));
                        sinon.assert.notCalled(put);
                        sinon.assert.notCalled(post);
                        sinon.assert.match(error.message, messagesFormatter.format(messages.static_analysis_report_not_found, runOptions.report.replace(/\\/g, '/')));
                        return;
                    }
                    sinon.assert.fail("Expected error to be thrown but it was not.");
                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            });


            it('parse report failed', async () => {
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                const parseError = new Error('Failed to parse report');
                const spawn = sandbox.fake.throws(parseError);
                sandbox.replace(cp, 'spawn', spawn);

                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());

                sinon.assert.calledWith(logError, parseError);
                sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.skip_static_analysis_report, path.join(__dirname, '/res/reports/XML_STATIC.xml')));
                sinon.assert.notCalled(post);
                sinon.assert.notCalled(put);
            });

            it('create report module failed', async () => {
                const fakeResponse: AxiosResponse = {
                    status: 500,
                    statusText: 'Internal Server Error',
                    headers: {},
                    config: {
                        headers: new AxiosHeaders('headers')
                    },
                    data: {message: 'Something went wrong'}
                };
                const fakeError = new AxiosError("Failed to create report module", undefined, undefined, undefined, fakeResponse);
                const put = sandbox.fake.rejects(fakeError)
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);
                try {
                    const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                    await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());
                } catch (error) {
                    if (error instanceof Error) {
                        sinon.assert.calledWith(logError, "{\n  \"message\": \"Something went wrong\"\n}");
                        sinon.assert.calledOnce(put);
                        sinon.assert.notCalled(post);
                        sinon.assert.match(error.message, messagesFormatter.format(messages.failed_to_create_report_module, 'dotTEST', fakeError));
                        return;
                    }

                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            });

            it('upload static analysis result failed', async () => {
                const fakeResponse: AxiosResponse = {
                    status: 500,
                    statusText: 'Internal Server Error',
                    headers: {},
                    config: {
                        headers: new AxiosHeaders('headers')
                    },
                    data: {message: 'Something went wrong'}
                };
                const fakeError = new AxiosError("Failed to upload static Analysis results", undefined, undefined, undefined, fakeResponse);
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.rejects(fakeError);
                sandbox.replace(axios, 'post', post);
                try {
                    const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                    await staticAnalysisParserRunner.run(runOptions, createBitbucketEnv());
                } catch (error) {
                    if (error instanceof Error) {
                        sinon.assert.calledWith(logError, "{\n  \"message\": \"Something went wrong\"\n}");
                        sinon.assert.calledOnce(put);
                        sinon.assert.calledOnce(post);
                        sinon.assert.match(error.message, messagesFormatter.format(messages.failed_to_upload_parasoft_report_results, 'dotTEST', fakeError));
                        return;
                    }

                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            });
        });

        const createBitbucketEnv = () => {
            return {
                USER_EMAIL: 'user@mail.com',
                API_TOKEN: 'api-token',
                BITBUCKET_REPO_SLUG: 'repo',
                BITBUCKET_COMMIT: 'commit',
                BITBUCKET_WORKSPACE: 'workspace',
                BITBUCKET_CLONE_DIR: __dirname,
                BITBUCKET_API_URL: 'https://api.bitbucket.org/2.0/repositories'
            };
        };
    });
})