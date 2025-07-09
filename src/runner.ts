import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as pt from 'path';
import * as glob from 'glob';
import * as sax from 'sax';
import * as types from './types';
import {v4 as uuidv4} from 'uuid'
import {logger} from './logger';
import {messages, messagesFormatter} from './messages';

export interface RunOptions {
    /* Specify a path or minimatch pattern to locate Parasoft static analysis report files */
    report: string;

    /* Specify a path to Parasoft tool installation folder or Java installation folder */
    parasoftToolOrJavaRootPath?: string;
}

interface ConversionResultDetails {
    exitCode: number;
    convertedReportPath?: string;
}

export interface Result {
    exitCode: number
}

export class StaticAnalysisParserRunner {
    WORKING_DIRECTORY = process.env.BITBUCKET_CLONE_DIR + '';

    async run(runOptions: RunOptions) : Promise<Result> {
        const parasoftReportPaths = await this.findParasoftStaticAnalysisReports(runOptions.report);
        if (!parasoftReportPaths || parasoftReportPaths.length == 0) {
            logger.warn(messagesFormatter.format(messages.static_analysis_report_not_found, runOptions.report));
            return { exitCode: -1 };
        }

        const javaFilePath = this.getJavaFilePath(runOptions.parasoftToolOrJavaRootPath);
        if (!javaFilePath) {
            return { exitCode: -1 }
        }

        let convertedReportResult: ConversionResultDetails = {exitCode: 1};
        for (const parasoftReportPath of parasoftReportPaths) {
            convertedReportResult = await this.convertReportsWithJava(javaFilePath, parasoftReportPath);
            if (convertedReportResult.exitCode == 0 && convertedReportResult.convertedReportPath) {
                const convertedReportPath = convertedReportResult.convertedReportPath;
                const convertedReportContents: types.ReportContents = await this.readConvertedReport(convertedReportPath);
                this.parseConvertedReport(convertedReportContents);

                // TODO: Implement uploading violation results to Bitbucket report module
            }
        }

        return { exitCode: convertedReportResult.exitCode };
    }

    private async findParasoftStaticAnalysisReports(reportPath: string): Promise<string[]> {
        if (pt.isAbsolute(reportPath)) {
            logger.info(messages.finding_static_analysis_report);
            // On Windows, if the path starts with '/', path.resolve() will prepend the current drive letter
            // Example: '/report.xml' -> 'C:/report.xml'
            reportPath = pt.resolve(reportPath);
        } else {
            logger.info(messagesFormatter.format(messages.finding_static_analysis_report_in_working_directory, this.WORKING_DIRECTORY));
            reportPath = pt.join(this.WORKING_DIRECTORY, reportPath);
        }

        reportPath = reportPath.replace(/\\/g, "/");

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
        return staticReportPaths;
    }

    private async convertReportsWithJava(javaPath: string, sourcePath: string): Promise<ConversionResultDetails> {
        const jarPath = pt.join(__dirname, "SaxonHE12-2J/saxon-he-12.2.jar");
        const xslPath = pt.join(__dirname, "sarif.xsl");
        const workspace = pt.normalize(this.WORKING_DIRECTORY).replace(/\\/g, '/');

        logger.debug(messagesFormatter.format(messages.converting_static_analysis_report_to_sarif, sourcePath));
        const outPath = sourcePath.substring(0, sourcePath.toLocaleLowerCase().lastIndexOf('.xml')) + '.sarif';

        const commandLine = `"${javaPath}" -jar "${jarPath}" -s:"${sourcePath}" -xsl:"${xslPath}" -o:"${outPath}" -versionmsg:off projectRootPaths="${workspace}"`;
        logger.debug(commandLine);
        const result = await new Promise<ConversionResultDetails>((resolve, reject) => {
            const process = cp.spawn(`${commandLine}`, {shell: true, windowsHide: true });
            this.handleProcess(process, resolve, reject);
        });

        if (result.exitCode != 0) {
            return { exitCode: result.exitCode };
        }
        logger.debug(messagesFormatter.format(messages.converted_sarif_report, outPath));

        return { exitCode: 0, convertedReportPath: outPath };
    }

    private handleProcess(process: any, resolve: any, reject: any) {
        process.stdout?.on('data', (data: any) => { logger.info(`${data}`.replace(/\s+$/g, '')); });
        process.stderr?.on('data', (data: any) => { logger.info(`${data}`.replace(/\s+$/g, '')); });
        process.on('close', (code: any) => {
            const result : ConversionResultDetails = {
                exitCode: (code != null) ? code : 150 // 150 = signal received
            };
            resolve(result);
        });
        process.on("error", (err: any) => { reject(err); });
    }

    private async isStaticReport(reportPath: string): Promise<boolean> {
        return new Promise((resolve) => {
            let isStaticReport = false;
            const saxStream = sax.createStream(true, {});
            saxStream.on("opentag", (node: { name: string; }) => {
                if (!isStaticReport && node.name == 'StdViols') {
                    isStaticReport = true;
                }
            });
            saxStream.on("error",(e) => {
                logger.warn(messagesFormatter.format(messages.failed_to_parse_static_analysis_report, reportPath, e.message))
                resolve(false);
            });
            saxStream.on("end", () => {
                resolve(isStaticReport);
            });
            fs.createReadStream(reportPath).pipe(saxStream);
        });
    }

    private getJavaFilePath(parasoftToolOrJavaRootPath: string | undefined): string | undefined {
        const javaInstallDir = parasoftToolOrJavaRootPath || process.env.JAVA_HOME;

        if (!javaInstallDir || !fs.existsSync(javaInstallDir)) {
            logger.warn(messages.java_or_parasoft_tool_install_dir_not_found);
            return undefined;
        }

        const javaFilePath = this.doGetJavaFilePath(javaInstallDir);
        if (!javaFilePath) {
            logger.warn(messagesFormatter.format(messages.java_not_found_in_java_or_parasoft_tool_install_dir));
        } else {
            logger.debug(messagesFormatter.format(messages.found_java_at, javaFilePath));
        }

        return javaFilePath;
    }

    private doGetJavaFilePath(installDir: string): string | undefined {
        logger.debug(messagesFormatter.format(messages.finding_java_in_java_or_parasoft_tool_install_dir, installDir));
        const javaFileName = os.platform() == "win32" ? "java.exe" : "java";
        const javaPaths = [
            "bin", // Java installation
            "bin/dottest/Jre_x64/bin", // dotTEST installation
            "bin/jre/bin" // C/C++test or Jtest installation
        ];

        for (const path of javaPaths) {
            const javaFilePath = pt.join(installDir, path, javaFileName);
            if (fs.existsSync(javaFilePath)) {
                return javaFilePath;
            }
        }

        return undefined;
    }

    private async readConvertedReport(reportPath: string): Promise<types.ReportContents> {
        const reportContent = await fs.promises.readFile(reportPath, 'utf8');
        return JSON.parse(reportContent);
    }

    private parseConvertedReport(reportContent: types.ReportContents): types.VulnerabilityDetail[] {
        logger.debug(messagesFormatter.format(messages.parsing_converted_report));

        const severityMap = {
            'note': 'LOW',
            'warning': 'MEDIUM',
            'error': 'HIGH',
            'critical': 'CRITICAL'
        };

        const rules: Record<string, types.Rule> = this.getRules(reportContent);
        const vulnerabilities: types.VulnerabilityDetail[] = reportContent.runs[0].results.map(result => ({
            external_id: uuidv4(),
            annotation_type: "VULNERABILITY",
            severity: severityMap[result.level],
            path: this.getPath(result),
            line: this.getLine(result),
            summary: this.getSummary(result, rules),
            details: result.message.text
        }));

        logger.debug(messagesFormatter.format(messages.parsed_converted_report, vulnerabilities.length));
        return vulnerabilities;
    }

    private getRules(reportContents: types.ReportContents) {
        const rules = reportContents.runs[0].tool.driver.rules;
        const map: Record<string, typeof rules[0]> = {};
        rules.forEach(rule => map[rule.id] = rule);
        return map;
    }

    private getPath(reportResult: types.ReportResult): string {
        return reportResult.locations[0].physicalLocation.artifactLocation.uri;
    }

    private getLine(reportResult: types.ReportResult): number {
        const region = reportResult.locations[0].physicalLocation.region;
        if (region.endLine != null) {
            return region.endLine;
        }

        return region.startLine;
    }

    private getSummary(
        reportResult: types.ReportResult,
        rulesMap: ReturnType<typeof this.getRules>
    ): string | undefined {
        const ruleId = reportResult.ruleId;
        const rule = rulesMap[ruleId];

        if (rule.fullDescription != null) {
            return rule.fullDescription.text;
        }

        if (rule.shortDescription != null) {
            return rule.shortDescription.text;
        }
    }
}