import * as fs from 'fs';
import * as pt from 'path';
import * as format from 'string-format';

interface ISerializable<T> {
    deserialize(jsonPath: string): T;
}

class Messages implements ISerializable<Messages> {
    missing_parameter!: string;
    run_failed!: string;
    parse_finished!: string;
    finding_static_analysis_report!: string;
    finding_static_analysis_report_in_working_directory!:string;
    found_matching_file!: string;
    static_analysis_report_not_found!: string;
    skipping_unrecognized_report_file!: string;
    failed_to_parse_static_analysis_report!: string;
    finding_java_in_java_or_parasoft_tool_install_dir!: string;
    java_or_parasoft_tool_install_dir_not_found!: string;
    java_not_found_in_java_or_parasoft_tool_install_dir!: string;
    found_java_at!: string;
    parsing_parasoft_report!: string;
    converting_static_analysis_report_to_sarif!: string;
    converted_sarif_report!: string;
    failed_parse_report!: string;
    parsing_sarif_report!: string;
    parsed_sarif_report!: string;

    deserialize(jsonPath: string) : Messages {
        const buf = fs.readFileSync(jsonPath);
        const json = JSON.parse(buf.toString('utf-8'));
        return json as Messages;
    }
}

class Formatter {
    format(template: string, ...args: any[]): string {
        return format(template, ...args);
    }
}

const jsonPath = pt.join(__dirname, 'messages/messages.json');
export const messages = new Messages().deserialize(jsonPath);
export const messagesFormatter = new Formatter();