import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as pt from 'path';
import * as glob from 'glob';
import * as sax from 'sax';
import * as sarifReportTypes from './sarifReportTypes';
import * as uuid from 'uuid'
import axios, {AxiosBasicCredentials, AxiosError} from "axios";
import {logger} from './logger';
import {messages, messagesFormatter} from './messages';
import {BitbucketEnvs} from './main'

(sax as any).MAX_BUFFER_LENGTH = 2 * 1024 * 1024 * 1024; // 2GB

export interface Result {
    exitCode: number;
}

export interface RunOptions {
    /* Specify a path or minimatch pattern to locate Parasoft static analysis report files */
    report: string;

    /* Specify a path to Parasoft tool installation folder or Java installation folder */
    parasoftToolOrJavaRootPath?: string;
}

interface ReportVulnerability {
    toolName: string;
    vulnerabilityDetails: sarifReportTypes.VulnerabilityDetail[];
}

export class StaticAnalysisParserRunner {
    UUID_NAMESPACE: string = '6af5b03d-5276-49ef-bfed-d445f2752b02';
    BITBUCKET_ENVS!: BitbucketEnvs;
    PARASOFT_SEV_LEVEL_MAP = { // Map Parasoft severity level to Bitbucket severity level
        '1': 'CRITICAL',
        '2': 'HIGH',
        '3': 'MEDIUM',
        '4': 'MEDIUM',
        '5': 'LOW'
    };

    vulnerabilityMap: Map<string, ReportVulnerability>;

    constructor() {
        this.vulnerabilityMap = new Map<string, ReportVulnerability>();
    }

    async run(runOptions: RunOptions, bitbucketEnvs: BitbucketEnvs): Promise<Result> {
        this.BITBUCKET_ENVS = bitbucketEnvs;
        const parasoftReportPaths = await this.findParasoftStaticAnalysisReports(runOptions.report);
        const javaExePath = this.getJavaPath(runOptions.parasoftToolOrJavaRootPath);

        for (const parasoftReportPath of parasoftReportPaths) {
            logger.info(messagesFormatter.format(messages.parsing_parasoft_report, parasoftReportPath));

            try {
                const sarifReport = await this.convertReportWithJava(javaExePath, parasoftReportPath);
                await this.parseSarifReport(sarifReport, parasoftReportPath);
            } catch (error) {
                if (error instanceof Error) {
                    logger.error(error);
                }
                logger.warn(messagesFormatter.format(messages.skip_static_analysis_report, parasoftReportPath));
            }
        }

        return await this.uploadReportResultsToBitbucket();
    }

    private async findParasoftStaticAnalysisReports(reportPath: string): Promise<string[]> {
        if (pt.isAbsolute(reportPath)) {
            logger.info(messages.finding_static_analysis_report);
            // On Windows, if the path starts with '/', path.resolve() will prepend the current drive letter
            // Example: '/report.xml' -> 'C:/report.xml'
            reportPath = pt.resolve(reportPath);
        } else {
            logger.info(messagesFormatter.format(messages.finding_static_analysis_report_in_working_directory, this.BITBUCKET_ENVS.BITBUCKET_CLONE_DIR));
            reportPath = pt.join(this.BITBUCKET_ENVS.BITBUCKET_CLONE_DIR, reportPath);
        }

        reportPath = reportPath.replace(/\\/g, '/');

        // Use glob to find the matching report paths
        const reportPaths: string[] = glob.sync(reportPath);

        const staticReportPaths: string[] = [];
        for (const reportPath of reportPaths) {
            if (!reportPath.toLocaleLowerCase().endsWith('.xml')) {
                logger.warn(messagesFormatter.format(messages.skipping_unrecognized_report_file, reportPath));
                continue;
            }

            const isStaticReport = await this.isStaticReport(reportPath);
            if (!isStaticReport) {
                logger.warn(messagesFormatter.format(messages.skipping_unrecognized_report_file, reportPath));
                continue;
            }
            logger.info(messagesFormatter.format(messages.found_matching_file, reportPath));
            staticReportPaths.push(reportPath);
        }

        if (!staticReportPaths || staticReportPaths.length == 0) {
            throw new Error(messagesFormatter.format(messages.static_analysis_report_not_found, reportPath));
        }

        return staticReportPaths;
    }

    private async convertReportWithJava(javaPath: string, sourcePath: string): Promise<string> {
        logger.debug(messagesFormatter.format(messages.converting_static_analysis_report_to_sarif, sourcePath));

        const jarPath = pt.join(__dirname, 'SaxonHE12-2J/saxon-he-12.2.jar');
        const xslPath = pt.join(__dirname, 'sarif.xsl');
        const workspace = pt.normalize(this.BITBUCKET_ENVS.BITBUCKET_CLONE_DIR).replace(/\\/g, '/');
        const outPath = sourcePath.substring(0, sourcePath.toLocaleLowerCase().lastIndexOf('.xml')) + '.sarif';

        const commandLine = `"${javaPath}" -jar "${jarPath}" -s:"${sourcePath}" -xsl:"${xslPath}" -o:"${outPath}" -versionmsg:off projectRootPaths="${workspace}"`;
        logger.debug(commandLine);
        const exitCode = await new Promise<number>((resolve, reject) => {
            const process = cp.spawn(`${commandLine}`, {shell: true, windowsHide: true});
            this.handleProcess(process, resolve, reject);
        });

        if (exitCode != 0) {
            throw new Error(messagesFormatter.format(messages.failed_parse_report, sourcePath));
        }

        logger.debug(messagesFormatter.format(messages.converted_sarif_report, outPath));
        return outPath;
    }

    private handleProcess(process: any, resolve: any, reject: any) {
        process.stdout?.on('data', (data: any) => {
            logger.info(`${data}`.replace(/\s+$/g, ''));
        });
        process.stderr?.on('data', (data: any) => {
            logger.info(`${data}`.replace(/\s+$/g, ''));
        });
        process.on('close', (code: any) => {
            const exitCode = (code != null) ? code : 150 // 150 = signal received
            resolve(exitCode);
        });
        process.on('error', (err: any) => {
            reject(err);
        });
    }

    private async isStaticReport(reportPath: string): Promise<boolean> {
        return new Promise((resolve) => {
            let isStaticReport = false;
            const saxStream = sax.createStream(true, {});
            saxStream.on('opentag', (node: { name: string; }) => {
                if (!isStaticReport && node.name == 'StdViols') {
                    isStaticReport = true;
                }
            });
            saxStream.on('error', (e) => {
                logger.warn(messagesFormatter.format(messages.failed_to_parse_static_analysis_report, reportPath, e.message));
                resolve(false);
            });
            saxStream.on('end', () => {
                resolve(isStaticReport);
            });
            fs.createReadStream(reportPath).pipe(saxStream);
        });
    }

    private getJavaPath(parasoftToolOrJavaRootPath: string | undefined): string {
        const javaInstallDir = parasoftToolOrJavaRootPath || process.env.JAVA_HOME;

        if (!javaInstallDir || !fs.existsSync(javaInstallDir)) {
            throw new Error(messagesFormatter.format(messages.java_or_parasoft_tool_install_dir_not_found));
        }

        const javaExePath = this.doGetJavaPath(javaInstallDir);
        if (!javaExePath) {
            throw new Error(messagesFormatter.format(messages.java_not_found_in_java_or_parasoft_tool_install_dir));
        } else {
            logger.debug(messagesFormatter.format(messages.found_java_at, javaExePath));
        }

        return javaExePath;
    }

    private doGetJavaPath(installDir: string): string | undefined {
        logger.debug(messagesFormatter.format(messages.finding_java_in_java_or_parasoft_tool_install_dir, installDir));
        const javaFileName = os.platform() == 'win32' ? 'java.exe' : 'java';
        const javaPaths = [
            'bin', // Java installation
            'bin/dottest/Jre_x64/bin', // dotTEST installation
            'bin/jre/bin' // C/C++test or Jtest installation
        ];

        for (const path of javaPaths) {
            const javaExePath = pt.join(installDir, path, javaFileName);
            if (fs.existsSync(javaExePath)) {
                return javaExePath;
            }
        }

        return undefined;
    }

    private async parseSarifReport(sarifReportPath: string, parasoftReportPath: string): Promise<void> {
        const reportContents = await this.readSarifReport(sarifReportPath);
        const {tool, results} = reportContents.runs[0];
        const rules = this.getRules(reportContents);

        const unbViolIdMap: Map<string, number> = new Map();
        let order: number = 0;

        const vulnerabilities = results
            .filter(result => !result.suppressions)
            .map(result => {
                const rule = rules[result.ruleId];
                let unbViolId = this.getUnbViolId(result, order);
                if (unbViolIdMap.has(unbViolId)) {
                    order = <number> unbViolIdMap.get(unbViolId);
                    unbViolId = this.getUnbViolId(result, order);
                }
                unbViolIdMap.set(unbViolId, order + 1);

                return {
                    external_id: unbViolId,
                    annotation_type: 'VULNERABILITY',
                    severity: this.getSeverityLevel(rule),
                    path: this.getPath(result),
                    line: this.getLine(result),
                    summary: this.getSummary(rule),
                    details: result.message.text
                };
            });

        this.vulnerabilityMap.set(parasoftReportPath, {
            toolName: tool.driver.name,
            vulnerabilityDetails: vulnerabilities
        });

        logger.info(messagesFormatter.format(messages.parsed_parasoft_static_analysis_report, vulnerabilities.length, parasoftReportPath));
    }

    private async readSarifReport(reportPath: string): Promise<sarifReportTypes.ReportContents> {
        const reportContent = await fs.promises.readFile(reportPath, 'utf8');
        return JSON.parse(reportContent);
    }

    private getRules(reportContents: sarifReportTypes.ReportContents) {
        const rules = reportContents.runs[0].tool.driver.rules;
        const map: Record<string, typeof rules[0]> = {};
        rules.forEach(rule => map[rule.id] = rule);
        return map;
    }

    private getPath(result: sarifReportTypes.ReportResult): string {
        return result.locations[0]?.physicalLocation?.artifactLocation?.uri;
    }

    private getLine(result: sarifReportTypes.ReportResult): number {
        const region = result.locations[0]?.physicalLocation?.region;
        return region?.startLine ?? region?.endLine;
    }

    private getSummary(rule: sarifReportTypes.Rule): string {
        return rule.fullDescription?.text ?? rule.shortDescription?.text ?? '';
    }

    private getSeverityLevel(rule: sarifReportTypes.Rule): string {
        return this.PARASOFT_SEV_LEVEL_MAP[rule.properties.parasoftSevLevel];
    }

    private getUnbViolId(result: sarifReportTypes.ReportResult, order: number): string {
        const unbViolId = result.partialFingerprints.unbViolId;
        if (unbViolId) {
            return unbViolId;
        }

        const violType = result.partialFingerprints?.violType || '';
        const ruleId = result.ruleId || '';
        const msg = result.message?.text || '';
        const severity = result.level || '';
        const lineHash = result.partialFingerprints?.lineHash || '';
        const uri = result.locations?.[0]?.physicalLocation?.artifactLocation?.uri || '';

        return uuid.v5(violType + ruleId + msg + severity + lineHash + uri + order, this.UUID_NAMESPACE);
    }

    private async uploadReportResultsToBitbucket(): Promise<Result> {
        let vulnerabilityNum = 0;
        for (const [parasoftReportPath, vulnerability] of this.vulnerabilityMap) {
            const toolName = vulnerability.toolName;
            let vulnerabilities = this.sortVulnerabilitiesBySevLevel(vulnerability.vulnerabilityDetails);
            const totalVulnerabilities = vulnerabilities.length;
            if (totalVulnerabilities == 0) {
                logger.info(messagesFormatter.format(messages.skip_static_analysis_report, parasoftReportPath));
                continue;
            }

            vulnerabilityNum += totalVulnerabilities;
            logger.info(messagesFormatter.format(messages.uploading_parasoft_report_results, toolName, parasoftReportPath));

            let reportDetails;
            //  A report module can contain up to 1000 annotations(vulnerabilities).
            // Reference: https://support.atlassian.com/bitbucket-cloud/docs/code-insights/#Annotations
            if (vulnerabilities.length > 1000) {
                vulnerabilities = vulnerabilities.slice(0, 1000);
                logger.info(messagesFormatter.format(messages.only_specified_vulnerabilities_will_be_uploaded, vulnerabilities.length));
                reportDetails = messagesFormatter.format(messages.report_details_description_2, parasoftReportPath, totalVulnerabilities, vulnerabilities.length);
            } else {
                reportDetails = messagesFormatter.format(messages.report_details_description_1, parasoftReportPath, totalVulnerabilities);
            }

            const reportId = uuid.v5(parasoftReportPath + this.BITBUCKET_ENVS.BITBUCKET_COMMIT, this.UUID_NAMESPACE);

            // Create report module
            try {
                await axios.put(this.getReportUrl(reportId), {
                    title: `Parasoft ${toolName}`,
                    details: reportDetails,
                    report_type: "SECURITY",
                    reporter: "Parasoft",
                    result: "FAILED"
                }, {auth: this.getAuth()});
            } catch (error) {
                if (error instanceof AxiosError) {
                    const data = error.response?.data;
                    if (data) {
                        logger.error(JSON.stringify(data, null, 2));
                    }
                }
                throw new Error(messagesFormatter.format(messages.failed_to_create_report_module, toolName, error));
            }

            try {
                // With POST …/annotations endpoint up to 100 annotations can be created or updated at once.
                // Reference: https://support.atlassian.com/bitbucket-cloud/docs/code-insights/#Annotations
                // Split the vulnerabilities into batches and each batch contains 100 vulnerabilities
                const vulnerabilityBatches: sarifReportTypes.VulnerabilityDetail[][] = [];
                for (let i = 0; i < vulnerabilities.length; i += 100) {
                    vulnerabilityBatches.push(vulnerabilities.slice(i, i + 100));
                }

                for (const vulnerabilityBatch of vulnerabilityBatches) {
                    // Upload report results
                    await axios.post(
                        `${this.getReportUrl(reportId)}/annotations`,
                        vulnerabilityBatch,
                        { auth: this.getAuth() }
                    );
                }
            } catch (error) {
                if (error instanceof AxiosError) {
                    const data = error.response?.data;
                    if (data) {
                        logger.error(JSON.stringify(data, null, 2));
                    }
                }
                throw new Error(messagesFormatter.format(messages.failed_to_upload_parasoft_report_results, toolName, error));
            }

            logger.info(messagesFormatter.format(messages.uploaded_parasoft_report_results, toolName, vulnerabilities.length));
        }

        const uploadResult: Result = {
            exitCode: 0,
        }
        if (vulnerabilityNum > 0) {
            uploadResult.exitCode = 1;
            logger.info(messagesFormatter.format(messages.mark_build_to_failed_due_to_vulnerability));
        }
        return uploadResult;
    }

    private getReportUrl(reportId: string): string {
        const { BITBUCKET_API_URL, BITBUCKET_WORKSPACE, BITBUCKET_REPO_SLUG, BITBUCKET_COMMIT } = this.BITBUCKET_ENVS;
        return `${BITBUCKET_API_URL}/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/commit/${BITBUCKET_COMMIT}/reports/${reportId}`;
    }

    private getAuth(): AxiosBasicCredentials {
        const { USER_EMAIL, API_TOKEN } = this.BITBUCKET_ENVS;
        return { username: USER_EMAIL, password: API_TOKEN };
    }

    private sortVulnerabilitiesBySevLevel(vulnerabilities: sarifReportTypes.VulnerabilityDetail[]): sarifReportTypes.VulnerabilityDetail[] {
        const severityOrder: { [key: string]: number } = {
            LOW: 1,
            MEDIUM: 2,
            HIGH: 3,
            CRITICAL: 4
        };

        return [...vulnerabilities].sort((currentVuln, nextVuln) => {
            return severityOrder[nextVuln.severity] - severityOrder[currentVuln.severity];
        });
    }
}