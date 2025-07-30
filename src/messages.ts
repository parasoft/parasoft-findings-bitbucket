import * as fs from 'fs';
import * as pt from 'path';
import * as format from 'string-format';

interface ISerializable<T> {
    deserialize(jsonPath: string): T;
}

class Messages implements ISerializable<Messages> {
    missing_java_parameter!: string;
    missing_required_parameter!: string;
    run_failed!: string;
    complete!: string;
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
    parsed_parasoft_static_analysis_report!: string;
    vulnerability_details_description_limitation!: string;
    vulnerability_full_details_description!: string;
    skip_static_analysis_report!: string;
    report_details_description_1!: string;
    report_details_description_2!: string;
    missing_required_environment_variables!: string;
    uploading_parasoft_report_results!: string;
    only_specified_vulnerabilities_will_be_uploaded!: string;
    uploaded_parasoft_report_results!: string;
    failed_to_create_report_module!: string;
    failed_to_upload_parasoft_report_results!: string;
    mark_build_to_failed_due_to_vulnerability!: string;

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