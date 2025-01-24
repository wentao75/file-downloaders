import { Page, ElementHandle } from 'puppeteer-core';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';

export class InternVLCaptchaService {
    private readonly API_URL: string;
    private readonly MODEL: string;

    constructor() {
        this.API_URL = process.env.VLLM_API_URL || 'http://127.0.0.1:8010/v1';
        this.MODEL = 'OpenGVLab/InternVL2-2B';
        console.log('使用验证码识别模型:', this.MODEL);
    }

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
        console.log('InternVLCaptchaService 初始化完成');
    }

    private async imageToBase64(imagePath: string): Promise<string> {
        const imageBuffer = await fs.readFile(imagePath);
        return imageBuffer.toString('base64');
    }

    private async recognizeWithVLLM(base64Image: string): Promise<string> {
        const startTime = Date.now();
        try {
            console.log('开始使用 InternVL2 识别验证码...');
            const prompt = `你现在是一个图片文字识别系统。请帮我识别图片中的文字。

规则：
1. 图片上只包含数字和大写字母
2. 长度为4-6位
3. 只需返回识别出的字符，不要包含任何其他文字
4. 如果看不清楚，只返回"看不清楚"
5. 不要猜测，如果不确定就说看不清楚
6. 返回结果不要添加除识别内容外的任何文字

图片内容：[图片数据已省略]`;

            const response = await axios.post(`${this.API_URL}/chat/completions`, {
                model: this.MODEL,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_tokens: 50,
                temperature: 0
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const endTime = Date.now();
            const duration = endTime - startTime;
            console.log(`InternVL2 响应耗时: ${duration}ms`);
            console.log('InternVL2 响应:', response.data);

            if (!response.data || !response.data.choices || !response.data.choices[0]?.message?.content) {
                throw new Error('InternVL2 响应格式错误');
            }

            const result = response.data.choices[0].message.content.trim();
            
            // 验证结果是否符合预期格式（4-6位数字和大写字母的组合）
            if (!/^[0-9A-Z]{4,6}$/.test(result)) {
                if (result.toLowerCase().includes('看不清楚')) {
                    throw new Error('验证码图片不清晰');
                }
                throw new Error('识别结果格式不正确');
            }

            return result;
        } catch (error) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.error(`InternVL2 API 调用失败 (耗时: ${duration}ms):`, error);
            throw error;
        }
    }

    async solveCaptcha(page: Page, selector: string = '#captcha-image'): Promise<string> {
        const startTime = Date.now();
        let tempImagePath = '';
        try {
            const tempDir = await this.ensureTempDir();
            
            console.log(`尝试查找验证码图片元素: ${selector}`);
            const captchaElement = await page.$(selector);
            if (!captchaElement) {
                throw new Error(`验证码图片元素未找到: ${selector}`);
            }

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

            // 获取图片的原始大小
            const dimensions = await captchaElement.evaluate((el) => {
                if (el instanceof HTMLImageElement) {
                    return {
                        width: el.naturalWidth,
                        height: el.naturalHeight
                    };
                }
                return {
                    width: el.getBoundingClientRect().width,
                    height: el.getBoundingClientRect().height
                };
            });

            console.log('验证码图片原始尺寸:', dimensions);
            
            // 生成唯一的文件名
            const timestamp = Date.now();
            tempImagePath = path.join(tempDir, `login-captcha-${timestamp}.png`);
            
            console.log('开始截取验证码图片...');
            await captchaElement.screenshot({
                path: tempImagePath,
                type: 'png',
                omitBackground: true,
                clip: {
                    x: 0,
                    y: 0,
                    width: dimensions.width,
                    height: dimensions.height
                }
            });
            console.log('验证码图片已保存到:', tempImagePath);

            // 等待文件写入完成
            await new Promise(resolve => setTimeout(resolve, 500));

            // 将图片转换为 base64
            const base64Image = await this.imageToBase64(tempImagePath);
            
            // 使用 InternVL2 识别验证码
            const result = await this.recognizeWithVLLM(base64Image);
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.log(`验证码识别完成，总耗时: ${duration}ms，识别结果:`, result);

            // 保存识别过程信息
            const logPath = tempImagePath.replace('.png', '.txt');
            const logContent = `
原始图片路径: ${tempImagePath}
InternVL2 模型: ${this.MODEL}
识别结果: ${result}
识别时间: ${new Date().toISOString()}
总耗时: ${duration}ms
            `;
            await fs.writeFile(logPath, logContent);
            
            return result;
        } catch (error) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.error(`验证码识别失败 (耗时: ${duration}ms):`, error);
            // 如果识别失败，保存错误信息
            if (tempImagePath) {
                const errorLogPath = tempImagePath.replace('.png', '.txt');
                await fs.writeFile(errorLogPath, `识别失败
错误信息: ${error instanceof Error ? error.message : String(error)}
总耗时: ${duration}ms`)
                    .catch(err => console.error('保存错误日志失败:', err));
            }
            throw error;
        }
    }

    async close() {
        // 保留验证码图片用于分析
        console.log('保留验证码图片用于分析');
    }
} 