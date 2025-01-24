import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import { config } from 'dotenv';

// 加载环境变量
config({ path: path.resolve(process.cwd(), '.env.local') });

export interface DownloadResult {
    success: boolean;
    error?: string;
    filePath?: string;
}

export class FileDownloader {
    protected browser: Browser | null = null;
    protected page: Page | null = null;
    protected downloadPath: string;

    constructor() {
        this.downloadPath = process.env.DOWNLOAD_PATH || './public/downloads';
    }

    async init(): Promise<boolean> {
        try {
            console.log('初始化浏览器...');
            this.browser = await puppeteer.launch({
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                headless: false,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            console.log('创建新页面...');
            this.page = await this.browser.newPage();
            
            // 设置页面视口
            await this.page.setViewport({ width: 1280, height: 800 });

            // 设置下载路径
            const client = await this.page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: this.downloadPath
            });

            console.log('浏览器初始化完成');
            return true;
        } catch (error) {
            console.error('浏览器初始化失败:', error);
            await this.close();
            throw error;
        }
    }

    async close(): Promise<void> {
        try {
            console.log('开始关闭浏览器...');
            if (this.page) {
                await this.page.close().catch(err => console.warn('关闭页面失败:', err));
                this.page = null;
            }
            if (this.browser) {
                await this.browser.close().catch(err => console.warn('关闭浏览器失败:', err));
                this.browser = null;
            }
            console.log('浏览器已关闭');
        } catch (error) {
            console.error('关闭浏览器时发生错误:', error);
            throw error;
        }
    }
} 