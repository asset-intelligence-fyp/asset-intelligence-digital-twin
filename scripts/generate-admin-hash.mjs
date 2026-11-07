import {randomBytes,scryptSync} from 'node:crypto';
import {stdin,stdout} from 'node:process';
import readline from 'node:readline';
const rl=readline.createInterface({input:stdin,output:stdout});
rl.question('Enter new admin password (input visible; avoid shared screens): ', password=>{
 rl.close();
 if(password.length<12){console.error('Use a password with at least 12 characters.');process.exitCode=1;return;}
 const salt=randomBytes(16).toString('hex');
 const hash=scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
 console.log('\nPaste ONLY into local .env (never commit):');
 console.log(`ADMIN_PASSWORD_HASH=scrypt:${salt}:${hash}`);
});
