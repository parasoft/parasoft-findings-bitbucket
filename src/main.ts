import * as pt from "path"
import * as fs from "fs";

export async function run(): Promise<void> {
    const packageJsonPath = pt.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    console.log(pkg.version);
}

run()