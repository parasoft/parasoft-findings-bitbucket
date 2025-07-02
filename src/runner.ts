import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as pt from 'path';
import * as glob from 'glob';
import * as sax from 'sax';
import {logger} from "./logger";

import {messages, messagesFormatter} from './messages';

export interface RunOptions {
    /* Specify a path or minimatch pattern to locate Parasoft static analysis report files */
    report: string;

    /* Specify a path to Parasoft tool installation folder or Java installation folder */
    parasoftToolOrJavaRootPath?: string;
}

export interface RunDetails {
    exitCode: number;
    convertedSarifReportPaths?: string[];
}

export class StaticAnalysisParserRunner {
    WORKING_DIRECTORY = process.env.BITBUCKET_CLONE_DIR + '';

    async run(runOptions: RunOptions) : Promise<RunDetails> {
        const parasoftReportPaths = await this.findParasoftStaticAnalysisReports(runOptions.report);
        if (!parasoftReportPaths || parasoftReportPaths.length == 0) {
            return Promise.reject(messagesFormatter.format(messages.static_analysis_report_not_found, runOptions.report));
        }

        const javaFilePath = this.getJavaFilePath(runOptions.parasoftToolOrJavaRootPath);
        if (!javaFilePath) {
            return { exitCode: -1 }
        }

        const outcome = await this.convertReportsWithJava(javaFilePath, parasoftReportPaths);

        // TODO: Implement obtaining violation results from converted sarif reports

        // TODO: Implement uploading violation results to Bitbucket report module

        return { exitCode: outcome.exitCode };
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

    private async convertReportsWithJava(javaPath: string, sourcePaths: string[]): Promise<RunDetails> {
        logger.debug(messages.using_java_to_convert_report);
        const jarPath = pt.join(__dirname, "SaxonHE12-2J/saxon-he-12.2.jar");
        const xslPath = pt.join(__dirname, "sarif.xsl");
        const sarifReports: string[] = [];
        const workspace = pt.normalize(this.WORKING_DIRECTORY).replace(/\\/g, '/');

        for (const sourcePath of sourcePaths) {
            logger.info(messagesFormatter.format(messages.converting_static_analysis_report_to_sarif, sourcePath));
            const outPath = sourcePath.substring(0, sourcePath.toLocaleLowerCase().lastIndexOf('.xml')) + '.sarif';

            const commandLine = `${javaPath} -jar "${jarPath}" -s:"${sourcePath}" -xsl:"${xslPath}" -o:"${outPath}" -versionmsg:off projectRootPaths="${workspace}"`;
            logger.debug(commandLine);
            const result = await new Promise<RunDetails>((resolve, reject) => {
                const process = cp.spawn(`${commandLine}`, {shell: true, windowsHide: true });
                this.handleProcess(process, resolve, reject);
            });

            if (result.exitCode != 0) {
                return { exitCode: result.exitCode };
            }
            sarifReports.push(outPath);
            logger.info(messagesFormatter.format(messages.converted_sarif_report, outPath));
        }

        return { exitCode: 0, convertedSarifReportPaths: sarifReports };
    }

    private handleProcess(process: any, resolve: any, reject: any) {
        process.stdout?.on('data', (data: any) => { console.info(`${data}`.replace(/\s+$/g, '')); });
        process.stderr?.on('data', (data: any) => { console.info(`${data}`.replace(/\s+$/g, '')); });
        process.on('close', (code: any) => {
            const result : RunDetails = {
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
            saxStream.on("error",() => {
                logger.warn(messagesFormatter.format(messages.failed_to_parse_static_analysis_report, reportPath))
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
}