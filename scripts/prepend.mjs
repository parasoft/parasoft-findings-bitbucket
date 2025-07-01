import fs from 'fs-extra';

const file = 'dist/index.js';
const content = await fs.readFile(file, 'utf8');
await fs.writeFile(file, '#!/usr/bin/env node\n' + content);
