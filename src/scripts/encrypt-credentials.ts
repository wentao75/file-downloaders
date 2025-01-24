import { credentialsManager } from '../lib/security/credentials';
import readline from 'readline';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// 加载环境变量
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env.local') });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer);
        });
    });
}

async function main() {
    try {
        if (!process.env.ENCRYPTION_KEY) {
            throw new Error('请先在.env.local文件中设置ENCRYPTION_KEY');
        }

        console.log('请输入凭据信息（输入内容不会显示）：');
        
        const username = await question('用户名: ');
        const password = await question('密码: ');

        const encrypted = credentialsManager.encryptCredentials(username, password);

        console.log('\n请将以下内容添加到.env.local文件中：\n');
        console.log(`JULIVES_USERNAME_ENCRYPTED=${encrypted.encryptedUsername}`);
        console.log(`JULIVES_PASSWORD_ENCRYPTED=${encrypted.encryptedPassword}`);
        
        console.log('\n注意：请妥善保管加密密钥！');
    } catch (error) {
        console.error('加密过程出错:', error);
    } finally {
        rl.close();
    }
}

main(); 