import type { Page } from 'puppeteer-core';
import tesseract from 'node-tesseract-ocr';
import path from 'path';
import fs from 'fs/promises';

export class CaptchaService {
    private config = {
        lang: "eng",
        oem: 1,
        psm: 7,
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        scale: 3,
        binary: "true",
        dpi: 300,
        contrast: 1.5,
        threshold: 0.5
    };

    private async ensureTempDir() {
        const tempDir = path.resolve(process.cwd(), 'captcha_images');
        try {
            await fs.access(tempDir);
        } catch {
            console.log('创建验证码目录:', tempDir);
            await fs.mkdir(tempDir, { recursive: true });
        }
        return tempDir;
    }

    async init() {
        await this.ensureTempDir();
        console.log('CaptchaService 初始化完成');
    }

    async solveCaptcha(page: Page, selector: string = '#captcha-image'): Promise<string> {
        let tempImagePath = '';
        try {
            const tempDir = await this.ensureTempDir();
            
            console.log(`尝试查找验证码图片元素: ${selector}`);
            const captchaElement = await page.$(selector);
            if (!captchaElement) {
                throw new Error(`验证码图片元素未找到: ${selector}`);
            }

            // 获取图片实际尺寸
            const dimensions = await captchaElement.boundingBox();
            if (!dimensions) {
                throw new Error('无法获取验证码图片尺寸');
            }
            console.log('验证码图片尺寸:', dimensions);

            // 等待图片完全加载
            await page.evaluate((sel) => {
                return new Promise((resolve, reject) => {
                    const img = document.querySelector(sel) as HTMLImageElement;
                    if (!img) {
                        reject(new Error('图片元素未找到'));
                        return;
                    }
                    if (img.complete) {
                        resolve(true);
                        return;
                    }
                    img.onload = () => resolve(true);
                    img.onerror = () => reject(new Error('图片加载失败'));
                });
            }, selector);

            // 生成唯一的文件名
            const timestamp = Date.now();
            tempImagePath = path.join(tempDir, `login-captcha-${timestamp}.png`);
            
            console.log('开始截取验证码图片...');
            await captchaElement.screenshot({
                path: tempImagePath,
                type: 'png',
                omitBackground: true,
                clip: {
                    x: dimensions.x,
                    y: dimensions.y,
                    width: dimensions.width,
                    height: dimensions.height
                }
            });
            console.log('验证码图片已保存到:', tempImagePath);

            // 等待文件写入完成
            await new Promise(resolve => setTimeout(resolve, 500));

            // 验证文件是否存在
            try {
                await fs.access(tempImagePath);
                console.log('验证码图片文件存在，开始识别...');
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`验证码图片文件未创建: ${errorMessage}`);
            }

            // 识别验证码
            console.log('开始识别验证码...');
            console.log('使用配置:', JSON.stringify(this.config, null, 2));
            
            const text = await tesseract.recognize(tempImagePath, this.config);
            console.log('OCR 原始结果:', text);
            
            if (!text || text.trim().length === 0) {
                throw new Error('OCR 识别结果为空');
            }

            const result = text.trim().replace(/[^0-9A-Z]/g, '');
            console.log('处理后的验证码结果:', result);

            if (!result || result.length === 0) {
                throw new Error('处理后的验证码结果为空');
            }

            // 保存识别过程信息
            const logPath = tempImagePath.replace('.png', '.txt');
            const logContent = `
原始图片路径: ${tempImagePath}
OCR 配置: ${JSON.stringify(this.config, null, 2)}
OCR 原始结果: ${text}
处理后结果: ${result}
识别时间: ${new Date().toISOString()}
            `;
            await fs.writeFile(logPath, logContent);
            
            return result;
        } catch (error) {
            console.error('验证码识别失败:', error);
            // 如果识别失败，保存错误信息
            if (tempImagePath) {
                const errorLogPath = tempImagePath.replace('.png', '.txt');
                await fs.writeFile(errorLogPath, '识别失败\n错误信息: ' + (error instanceof Error ? error.message : String(error)))
                    .catch(err => console.error('保存错误日志失败:', err));
            }
            throw error;
        }
    }

    async close() {
        // 不再自动清理验证码图片，保留用于分析
        console.log('保留验证码图片用于分析');
    }
} 