import {readFileSync,writeFileSync} from 'node:fs';
const id=process.argv[2];
if(!id||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)){console.error('Usage: node scripts/configure-cloudflare.mjs <D1 database UUID>');process.exit(1);}
const file=new URL('../wrangler.deploy.jsonc',import.meta.url);
const config=JSON.parse(readFileSync(file,'utf8'));
config.d1_databases[0].database_id=id;
writeFileSync(file,JSON.stringify(config,null,2)+'\n');
console.log('D1 database configured. Run pnpm db:migrate:remote before deploying.');
