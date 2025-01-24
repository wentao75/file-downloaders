import crypto from 'crypto';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
config({ path: path.resolve(process.cwd(), '.env.local') });

interface Credentials {
    username: string;
    password: string;
}

class CredentialsManager {
    private readonly encryptionKey: string;
    private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
    private readonly AUTH_TAG_LENGTH = 16; // GCM 认证标签长度（字节）
    private readonly IV_LENGTH = 12; // GCM 推荐的 IV 长度（字节）

    constructor() {
        const key = process.env.ENCRYPTION_KEY;
        if (!key) {
            throw new Error('未找到加密密钥');
        }
        if (key.length !== 64) { // 256位密钥的十六进制表示应为64字符
            throw new Error('加密密钥长度不正确，应为64个十六进制字符（256位）');
        }
        this.encryptionKey = key;
    }

    private validateEncryptedFormat(encryptedText: string): { encryptedData: string; iv: string; authTag: string } {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            throw new Error('加密数据格式错误：应包含三个部分（iv:authTag:encryptedData）');
        }

        const [iv, authTag, encryptedData] = parts;
        
        // 验证 IV 长度（24个十六进制字符 = 12字节）
        if (iv.length !== this.IV_LENGTH * 2) {
            throw new Error(`IV 长度错误：应为 ${this.IV_LENGTH * 2} 个十六进制字符`);
        }

        // 验证认证标签长度（32个十六进制字符 = 16字节）
        if (authTag.length !== this.AUTH_TAG_LENGTH * 2) {
            throw new Error(`认证标签长度错误：应为 ${this.AUTH_TAG_LENGTH * 2} 个十六进制字符`);
        }

        return { encryptedData, iv, authTag };
    }

    private decrypt(encryptedText: string): string {
        try {
            console.log('开始解密过程...');
            const { encryptedData, iv, authTag } = this.validateEncryptedFormat(encryptedText);

            console.log('解密参数验证通过，创建解密器...');
            const decipher = crypto.createDecipheriv(
                this.ENCRYPTION_ALGORITHM,
                Buffer.from(this.encryptionKey, 'hex'),
                Buffer.from(iv, 'hex')
            );

            console.log('设置认证标签...');
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));

            console.log('执行解密...');
            const decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            const final = decipher.final('utf8');
            
            console.log('解密完成');
            return decrypted + final;
        } catch (error) {
            console.error('解密失败:', error);
            if (error instanceof Error) {
                throw new Error(`解密失败: ${error.message}`);
            }
            throw new Error('解密过程中发生未知错误');
        }
    }

    getCredentials(): Credentials {
        console.log('开始获取凭据...');
        const encryptedUsername = process.env.JULIVES_USERNAME_ENCRYPTED;
        const encryptedPassword = process.env.JULIVES_PASSWORD_ENCRYPTED;

        if (!encryptedUsername || !encryptedPassword) {
            throw new Error('未找到加密的凭据，请检查环境变量');
        }

        try {
            console.log('解密用户名...');
            const username = this.decrypt(encryptedUsername);
            
            console.log('解密密码...');
            const password = this.decrypt(encryptedPassword);

            return { username, password };
        } catch (error) {
            console.error('获取凭据失败:', error);
            throw error;
        }
    }

    public encryptCredentials(username: string, password: string): {
        encryptedUsername: string;
        encryptedPassword: string;
    } {
        try {
            console.log('开始加密凭据...');
            return {
                encryptedUsername: this.encrypt(username),
                encryptedPassword: this.encrypt(password)
            };
        } catch (error) {
            console.error('加密凭据失败:', error);
            throw error;
        }
    }

    private encrypt(text: string): string {
        try {
            console.log('开始加密过程...');
            const iv = crypto.randomBytes(this.IV_LENGTH);
            const cipher = crypto.createCipheriv(
                this.ENCRYPTION_ALGORITHM,
                Buffer.from(this.encryptionKey, 'hex'),
                iv
            );
            
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag();

            const result = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
            console.log('加密成功');
            return result;
        } catch (error) {
            console.error('加密失败:', error);
            if (error instanceof Error) {
                throw new Error(`加密失败: ${error.message}`);
            }
            throw new Error('加密过程中发生未知错误');
        }
    }
}

export const credentialsManager = new CredentialsManager();
export { type Credentials }; 