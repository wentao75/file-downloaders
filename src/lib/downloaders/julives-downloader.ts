import { FileDownloader, DownloadResult } from '../downloader/downloader';
import { format } from 'date-fns';
import path from 'path';
import { credentialsManager } from '../security/credentials';
import { ElementHandle } from 'puppeteer-core';
import { OllamaCaptchaService } from '../captcha/ollama-captcha';

export class JulivesDownloader extends FileDownloader {
    private readonly SELECTORS = {
        USERNAME: '#username',
        PASSWORD: '#password',
        CAPTCHA_INPUT: '#authCode',
        CAPTCHA_IMAGE: '#captchaImgId',
        LOGIN_BUTTON: '#loginbtn',
        // BUSINESS_MENU: '//span[contains(text(), "业务功能")]',
        // #menuTreeId_4_span
        // #menuTreeId_4_a
        ORDER_RECORDS: 'a#menuTreeId_4_a',
        // #queryDate 查询日期
        DATE_INPUT: 'input#queryDate',
        // select#status, 
        STATUS_SELECT: 'select#status',
        // #status > option:nth-child(4)
        STATUS_OPTION: 'option[contains(text(), "交易成功")]',
        // #exportBtn
        EXPORT_BUTTON: 'button#exportBtn'
    };

    private ollamaCaptchaService: OllamaCaptchaService;

    constructor() {
        super();
        this.ollamaCaptchaService = new OllamaCaptchaService();
    }

    async init(): Promise<boolean> {
        const baseInit = await super.init();
        await this.ollamaCaptchaService.init();
        return baseInit;
    }

    async downloadDailyReport(date?: Date): Promise<DownloadResult> {
        if (!this.page) {
            return { success: false, error: '浏览器未初始化' };
        }

        try {
            // 1. 登录处理
            const loginResult = await this.login();
            if (!loginResult.success) {
                return loginResult;
            }

            // 2. 等待页面加载完成
            await this.page.waitForTimeout(2000);

            // 登录后主页面就已经显示菜单，不需要在点击
            // // 3. 点击业务功能菜单
            // await this.page.waitForXPath(this.SELECTORS.BUSINESS_MENU);
            // const businessMenu = await this.page.$x(this.SELECTORS.BUSINESS_MENU);
            // if (!businessMenu[0]) {
            //     return { success: false, error: '未找到业务功能菜单' };
            // }
            // await businessMenu[0].evaluate(el => (el as HTMLElement).click());

            // 4. 点击订单交易记录
            console.log('等待订单交易记录菜单加载...');
            
            // 记录页面内容用于调试
            const pageContent = await this.page.content();
            // console.log('当前页面HTML结构:', pageContent);
            
            // 检查所有链接元素
            const menuElements = await this.page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                return links.map(link => ({
                    id: link.id,
                    text: link.textContent,
                    href: link.href,
                    class: link.className,
                    isVisible: link.offsetParent !== null
                }));
            });
            // console.log('页面上的所有链接元素:', JSON.stringify(menuElements, null, 2));

            // 尝试多个选择器
            const menuSelectors = [
                'a#menuTreeId_4_a',
                '#menuTreeId_4_a',
                'a[href*="orderRecord"]',
                'a:contains("订单交易记录")',
                '#menuTreeId_4_span',
                '#menuTreeId_4'
            ];

            let orderRecordsMenu = null;
            for (const selector of menuSelectors) {
                console.log(`尝试使用选择器: ${selector}`);
                try {
                    await this.page.waitForSelector(selector, { timeout: 5000 });
                    orderRecordsMenu = await this.page.$(selector);
                    if (orderRecordsMenu) {
                        console.log(`使用选择器 ${selector} 找到菜单元素`);
                        break;
                    }
                } catch (error) {
                    console.log(`选择器 ${selector} 未找到元素:`, error.message);
                }
            }

            // 如果选择器方法失败，尝试 XPath
            if (!orderRecordsMenu) {
                console.log('尝试使用 XPath 查找菜单...');
                const xpathQueries = [
                    '//a[@id="menuTreeId_4_a"]',
                    '//a[contains(text(), "订单交易记录")]',
                    '//span[contains(text(), "订单交易记录")]/..',
                    '//a[contains(@href, "orderRecord")]'
                ];

                for (const xpath of xpathQueries) {
                    console.log(`尝试 XPath: ${xpath}`);
                    const elements = await this.page.$x(xpath);
                    if (elements.length > 0) {
                        orderRecordsMenu = elements[0];
                        console.log(`使用 XPath ${xpath} 找到菜单元素`);
                        break;
                    }
                }
            }

            if (!orderRecordsMenu) {
                // 保存页面截图以便调试
                const screenshotPath = 'menu-not-found.png';
                await this.page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`已保存页面截图到 ${screenshotPath}`);
                return { success: false, error: '未找到订单交易记录菜单' };
            }

            console.log('找到菜单元素，准备点击...');
            await orderRecordsMenu.click().catch(async (error) => {
                console.error('直接点击失败:', error);
                // 尝试使用 evaluate 方式点击
                await this.page.evaluate(element => {
                    if (element instanceof HTMLElement) {
                        element.click();
                    }
                }, orderRecordsMenu);
            });

            // 等待页面加载
            await this.page.waitForTimeout(5000);

            // 等待 iframe 加载
            console.log('等待 iframe 加载...');
            await this.page.waitForSelector('div#tabs_center iframe#merchantopMerchantSelfdoactiontoMerchantRecharge-tabFrame', { timeout: 30000 });
            
            // 切换到 iframe 上下文
            const frames = await this.page.frames();
            const targetFrame = frames.find(frame => frame.url().includes('merchantopMerchantSelfdoactiontoMerchantRecharge'));
            
            if (!targetFrame) {
                console.error('未找到目标 iframe');
                const screenshotPath = 'iframe-not-found.png';
                await this.page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`已保存页面截图到 ${screenshotPath}`);
                return { success: false, error: '未找到目标 iframe' };
            }

            console.log('切换到 iframe 上下文');

            // 5. 设置日期
            console.log('等待页面内容加载...');
            
            // 等待页面完全加载
            await targetFrame.waitForFunction(() => {
                return document.readyState === 'complete' && 
                       !!document.querySelector('input') &&
                       window.getComputedStyle(document.body).visibility === 'visible';
            }, { timeout: 30000 });

            // 检查所有输入框元素
            const inputElements = await targetFrame.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input'));
                return inputs.map(input => ({
                    type: input.type,
                    id: input.id,
                    name: input.name,
                    class: input.className,
                    value: input.value,
                    placeholder: input.placeholder,
                    isVisible: input.offsetParent !== null,
                    position: {
                        x: input.getBoundingClientRect().x,
                        y: input.getBoundingClientRect().y
                    }
                }));
            });
            console.log('iframe 中的所有输入框元素:', JSON.stringify(inputElements, null, 2));

            const targetDate = date || new Date(Date.now() - 86400000); // 默认昨天
            const formattedDate = format(targetDate, 'yyyy-MM-dd');
            
            // 尝试多个选择器
            const dateSelectors = [
                'input#queryDate',
                '#queryDate',
                'input[placeholder*="日期"]',
                'input[type="date"]',
                '.ant-calendar-picker-input',
                '.date-picker',
                'input[name="queryDate"]',
                'input.date-input'
            ];

            let dateInput: ElementHandle<HTMLElement> | null = null;
            for (const selector of dateSelectors) {
                console.log(`尝试在 iframe 中使用选择器: ${selector}`);
                try {
                    await targetFrame.waitForSelector(selector, { 
                        timeout: 10000, 
                        visible: true
                    });
                    const element = await targetFrame.$(selector);
                    if (element) {
                        // 检查元素是否可见和可交互
                        const isVisible = await targetFrame.evaluate((el) => {
                            const style = window.getComputedStyle(el);
                            return style.display !== 'none' && 
                                   style.visibility !== 'hidden' && 
                                   style.opacity !== '0' &&
                                   el.offsetParent !== null;
                        }, element);

                        if (isVisible) {
                            dateInput = element as ElementHandle<HTMLElement>;
                            console.log(`使用选择器 ${selector} 在 iframe 中找到日期输入框`);
                            break;
                        } else {
                            console.log(`选择器 ${selector} 找到元素但不可见`);
                        }
                    }
                } catch (err) {
                    console.log(`选择器 ${selector} 未找到元素:`, err instanceof Error ? err.message : String(err));
                }
            }

            // 如果选择器方法失败，尝试 XPath
            if (!dateInput) {
                console.log('尝试在 iframe 中使用 XPath 查找日期输入框...');
                const xpathQueries = [
                    '//input[@id="queryDate"]',
                    '//input[contains(@placeholder, "日期")]',
                    '//input[@type="date"]',
                    '//div[contains(@class, "date-picker")]//input',
                    '//label[contains(text(), "日期")]//following::input[1]',
                    '//input[contains(@class, "date")]'
                ];

                for (const xpath of xpathQueries) {
                    console.log(`尝试 XPath: ${xpath}`);
                    const elements = await targetFrame.$x(xpath);
                    if (elements.length > 0) {
                        const element = elements[0];
                        // 检查元素是否可见
                        const isVisible = await targetFrame.evaluate((el) => {
                            const style = window.getComputedStyle(el);
                            return style.display !== 'none' && 
                                   style.visibility !== 'hidden' && 
                                   style.opacity !== '0' &&
                                   el.offsetParent !== null;
                        }, element);

                        if (isVisible) {
                            dateInput = element as ElementHandle<HTMLElement>;
                            console.log(`使用 XPath ${xpath} 在 iframe 中找到日期输入框`);
                            break;
                        } else {
                            console.log(`XPath ${xpath} 找到元素但不可见`);
                        }
                    }
                }
            }

            if (!dateInput) {
                // 保存页面截图以便调试
                const screenshotPath = 'date-input-not-found.png';
                await targetFrame.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`已保存 iframe 截图到 ${screenshotPath}`);
                return { success: false, error: '未找到日期输入框' };
            }

            console.log('找到日期输入框，准备输入日期...');
            
            // 确保元素在视图中
            await targetFrame.evaluate((element) => {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, dateInput);
            await this.page.waitForTimeout(1000);

            // 尝试多种方式输入日期
            try {
                // 方式1：使用 evaluate 直接设置值并触发事件
                await targetFrame.evaluate((element, date) => {
                    if (element instanceof HTMLInputElement) {
                        // 清空现有值
                        element.value = '';
                        // 聚焦输入框
                        element.focus();
                        // 设置新值
                        element.value = date;
                        // 触发所有可能的事件
                        const events = [
                            new Event('input', { bubbles: true }),
                            new Event('change', { bubbles: true }),
                            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
                            new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }),
                            new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }),
                            new Event('blur', { bubbles: true })
                        ];
                        events.forEach(event => element.dispatchEvent(event));
                    }
                }, dateInput, formattedDate);

                await this.page.waitForTimeout(1000);

                // 方式2：如果方式1失败，尝试模拟键盘输入
                const currentValue = await targetFrame.evaluate((element) => {
                    return element instanceof HTMLInputElement ? element.value : '';
                }, dateInput);

                if (currentValue !== formattedDate) {
                    console.log('直接设置值失败，尝试模拟键盘输入...');
                    // 清空现有值
                    await targetFrame.evaluate((element) => {
                        if (element instanceof HTMLInputElement) {
                            element.value = '';
                            element.focus();
                        }
                    }, dateInput);
                    
                    // 模拟键盘输入
                    await dateInput.type(formattedDate, { delay: 100 });
                    await this.page.keyboard.press('Enter');
                    await this.page.waitForTimeout(500);
                    
                    // 再次触发 change 事件
                    await targetFrame.evaluate((element, date) => {
                        if (element instanceof HTMLInputElement) {
                            const event = new Event('change', { bubbles: true });
                            element.dispatchEvent(event);
                        }
                    }, dateInput, formattedDate);
                }

                // 方式3：如果前两种方式都失败，尝试使用日期选择器的特定方法
                const finalValue = await targetFrame.evaluate((element) => {
                    return element instanceof HTMLInputElement ? element.value : '';
                }, dateInput);

                if (finalValue !== formattedDate) {
                    console.log('常规输入方式失败，尝试特定日期选择器方法...');
                    await targetFrame.evaluate((element, date) => {
                        // 尝试查找和触发日期选择器的特定方法
                        const input = element;
                        if (input) {
                            // 查找可能的日期选择器实例
                            const datePicker = input.parentElement?.querySelector('.ant-calendar-picker') ||
                                             input.closest('.ant-calendar-picker') ||
                                             input.parentElement?.querySelector('.date-picker');
                            
                            if (datePicker) {
                                // 触发日期选择器的点击事件
                                datePicker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                
                                // 设置输入值
                                if (input instanceof HTMLInputElement) {
                                    input.value = date;
                                    // 触发所有可能的事件
                                    ['input', 'change', 'blur'].forEach(eventType => {
                                        input.dispatchEvent(new Event(eventType, { bubbles: true }));
                                    });
                                }
                                
                                // 模拟确认选择
                                setTimeout(() => {
                                    const confirmBtn = document.querySelector('.ant-calendar-ok-btn') ||
                                                     document.querySelector('.date-picker-confirm');
                                    if (confirmBtn) {
                                        (confirmBtn as HTMLElement).click();
                                    }
                                }, 100);
                            }
                        }
                    }, dateInput, formattedDate);
                }
            } catch (error) {
                console.error('日期输入失败:', error instanceof Error ? error.message : String(error));
                throw new Error('无法设置日期');
            }

            console.log('日期已输入:', formattedDate);
            await this.page.waitForTimeout(2000);

            // 验证日期是否正确设置
            const finalDateValue = await targetFrame.evaluate((element) => {
                return element instanceof HTMLInputElement ? element.value : '';
            }, dateInput);

            if (finalDateValue !== formattedDate) {
                console.error('日期设置验证失败，实际值:', finalDateValue);
                return { success: false, error: '日期设置失败' };
            }

            console.log('日期设置已验证:', finalDateValue);

            // 6. 设置订单状态
            console.log('等待订单状态选择框加载...');
            await targetFrame.waitForSelector('select#status', { timeout: 10000, visible: true });
            const statusSelect = await targetFrame.$('select#status');
            if (!statusSelect) {
                console.error('未找到订单状态选择框');
                return { success: false, error: '未找到订单状态选择框' };
            }

            // 点击状态选择框
            await statusSelect.click();
            await this.page.waitForTimeout(1000);

            // 查找并选择"交易成功"选项
            console.log('查找交易成功选项...');
            let successOption = null;

            // 方式1：使用 evaluate 直接在选择框中查找
            try {
                await targetFrame.evaluate((select) => {
                    if (select instanceof HTMLSelectElement) {
                        const options = Array.from(select.options);
                        const targetOption = options.find(option => 
                            option.textContent?.includes('交易成功')
                        );
                        if (targetOption) {
                            select.value = targetOption.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                }, statusSelect);
                console.log('已选择交易成功选项');
            } catch (error) {
                console.log('使用 evaluate 选择失败，尝试其他方式...');

                // 方式2：使用 XPath
                const xpathQueries = [
                    '//select[@id="status"]/option[contains(text(), "交易成功")]',
                    '//option[contains(text(), "交易成功")]',
                    '//select/option[contains(text(), "交易成功")]'
                ];

                for (const xpath of xpathQueries) {
                    console.log(`尝试 XPath: ${xpath}`);
                    const elements = await targetFrame.$x(xpath);
                    if (elements.length > 0) {
                        successOption = elements[0];
                        console.log('使用 XPath 找到交易成功选项');
                        break;
                    }
                }

                if (successOption) {
                    // 使用 evaluate 设置选项
                    await targetFrame.evaluate((select, option) => {
                        if (select instanceof HTMLSelectElement && option instanceof HTMLOptionElement) {
                            select.value = option.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, statusSelect, successOption);
                } else {
                    console.error('未找到交易成功选项');
                    return { success: false, error: '未找到交易成功选项' };
                }
            }

            await this.page.waitForTimeout(2000);

            // 7. 点击导出按钮
            console.log('等待导出按钮加载...');
            await targetFrame.waitForSelector('button#exportBtn', { timeout: 10000, visible: true });
            const exportButton = await targetFrame.$('button#exportBtn');
            if (!exportButton) {
                console.error('未找到导出按钮');
                return { success: false, error: '未找到导出按钮' };
            }

            // 确保导出按钮可见和可点击
            const isExportButtonVisible = await targetFrame.evaluate((button) => {
                const style = window.getComputedStyle(button);
                return style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       style.opacity !== '0' &&
                       !button.disabled;
            }, exportButton);

            if (!isExportButtonVisible) {
                console.error('导出按钮不可用');
                return { success: false, error: '导出按钮不可用' };
            }

            console.log('点击导出按钮...');
            await exportButton.click().catch(async (error) => {
                console.error('直接点击导出按钮失败:', error);
                // 尝试使用 evaluate 方式点击
                await targetFrame.evaluate((button) => {
                    if (button instanceof HTMLButtonElement) {
                        button.click();
                    }
                }, exportButton);
            });

            // 8. 等待下载完成
            await this.page.waitForTimeout(5000);

            const expectedFileName = `julives_order_${formattedDate}.xlsx`;
            const filePath = path.join(this.downloadPath, expectedFileName);

            return {
                success: true,
                filePath,
                message: `成功下载${formattedDate}的对账文件`
            };

        } catch (error) {
            return {
                success: false,
                error: `下载失败: ${error instanceof Error ? error.message : '未知错误'}`
            };
        }
    }

    protected async login(): Promise<DownloadResult> {
        if (!this.page) {
            return { success: false, error: '浏览器未初始化' };
        }

        try {
            console.log('开始登录流程...');
            
            // 1. 访问登录页
            console.log('访问登录页面...');
            await this.page.goto('http://mgr.julives.com/mgr/');
            await this.page.waitForTimeout(3000);
            
            // 2. 等待登录表单加载
            console.log('等待登录表单加载...');
            
            // 检查并记录页面内容，用于调试
            const pageContent = await this.page.content();
            console.log('页面HTML结构:', pageContent);
            
            // 检查所有表单元素
            const formElements = await this.page.evaluate(() => {
                const forms = Array.from(document.querySelectorAll('form'));
                const inputs = Array.from(document.querySelectorAll('input'));
                const buttons = Array.from(document.querySelectorAll('button'));
                return {
                    forms: forms.map(form => ({
                        id: form.id,
                        class: form.className,
                        action: form.action,
                        method: form.method
                    })),
                    inputs: inputs.map(input => ({
                        type: input.type,
                        id: input.id,
                        name: input.name,
                        class: input.className,
                        value: input.value,
                        isVisible: input.offsetParent !== null
                    })),
                    buttons: buttons.map(button => ({
                        type: button.type,
                        text: button.textContent,
                        class: button.className,
                        id: button.id,
                        isVisible: button.offsetParent !== null,
                        disabled: button.disabled,
                        attributes: Array.from(button.attributes).map(attr => ({
                            name: attr.name,
                            value: attr.value
                        }))
                    }))
                };
            });
            console.log('表单元素详细信息:', JSON.stringify(formElements, null, 2));

            // 等待用户名输入框
            console.log('等待用户名输入框...');
            await this.page.waitForSelector(this.SELECTORS.USERNAME, { timeout: 10000, visible: true })
                .catch(() => { throw new Error('未找到用户名输入框'); });

            // 等待密码输入框
            console.log('等待密码输入框...');
            await this.page.waitForSelector(this.SELECTORS.PASSWORD, { timeout: 10000, visible: true })
                .catch(() => { throw new Error('未找到密码输入框'); });

            // 3. 处理验证码
            console.log('等待验证码图片加载...');
            await this.page.waitForSelector(this.SELECTORS.CAPTCHA_IMAGE, { timeout: 10000, visible: true })
                .catch(() => { throw new Error('未找到验证码图片'); });

            console.log('等待验证码输入框加载...');
            await this.page.waitForSelector(this.SELECTORS.CAPTCHA_INPUT, { timeout: 10000, visible: true })
                .catch(() => { throw new Error('未找到验证码输入框'); });

            // 验证码识别重试逻辑
            const maxRetries = 3;
            let retryCount = 0;
            let captchaResult = '';
            let isValidCaptcha = false;

            while (!isValidCaptcha && retryCount < maxRetries) {
                try {
                    retryCount++;
                    console.log(`开始第 ${retryCount}/${maxRetries} 次验证码识别...`);

                    if (retryCount > 1) {
                        console.log('点击验证码图片刷新...');
                        const captchaImage = await this.page.$(this.SELECTORS.CAPTCHA_IMAGE);
                        if (captchaImage) {
                            await captchaImage.click();
                            await this.page.waitForTimeout(1000);
                        }
                    }

                    captchaResult = await this.ollamaCaptchaService.solveCaptcha(this.page, this.SELECTORS.CAPTCHA_IMAGE);
                    console.log(`第 ${retryCount} 次验证码识别结果:`, captchaResult);

                    console.log('输入验证码...');
                    // 清空之前的输入
                    await this.page.$eval(this.SELECTORS.CAPTCHA_INPUT, (el) => {
                        if (el instanceof HTMLInputElement) {
                            el.value = '';
                            return el.value;
                        }
                        return '';
                    });
                    await this.page.type(this.SELECTORS.CAPTCHA_INPUT, captchaResult);
                    console.log('验证码已输入:', captchaResult);

                    // 检查验证码错误提示
                    await this.page.waitForTimeout(500); // 等待错误提示出现
                    const errorMessage = await this.page.evaluate(() => {
                        // 检查常见的错误提示元素
                        const errorElements = [
                            '.ant-message-error',           // Ant Design 错误提示
                            '.ant-form-item-explain-error', // Ant Design 表单错误
                            '.error-message',               // 通用错误类名
                            '[role="alert"]',               // ARIA role
                            '.text-red-500',               // Tailwind 错误文本
                        ];

                        for (const selector of errorElements) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent) {
                                return element.textContent.trim();
                            }
                        }

                        // 查找包含"错误"或"invalid"的文本
                        const errorTextElements = Array.from(document.querySelectorAll('*')).find(el => {
                            const text = el.textContent?.toLowerCase() || '';
                            return text.includes('错误') || 
                                   text.includes('invalid') || 
                                   text.includes('incorrect') ||
                                   text.includes('验证码');
                        });

                        return errorTextElements?.textContent?.trim() || null;
                    });

                    if (errorMessage) {
                        console.error(`第 ${retryCount} 次验证码验证失败:`, errorMessage);
                        continue;
                    }

                    // 如果没有错误提示，认为验证码正确
                    isValidCaptcha = true;
                    console.log(`第 ${retryCount} 次验证码验证成功`);

                } catch (error) {
                    console.error(`第 ${retryCount} 次验证码处理失败:`, error);
                    if (retryCount === maxRetries) {
                        throw error;
                    }
                }
            }

            if (!isValidCaptcha) {
                throw new Error(`验证码识别失败，已尝试 ${maxRetries} 次`);
            }

            // 4. 获取并使用加密的凭据
            console.log('获取登录凭据...');
            const credentials = credentialsManager.getCredentials();

            // 5. 输入凭据
            console.log('输入用户名...');
            await this.page.type(this.SELECTORS.USERNAME, credentials.username);
            
            console.log('输入密码...');
            await this.page.type(this.SELECTORS.PASSWORD, credentials.password);

            // 6. 查找并点击登录按钮
            console.log('开始查找登录按钮...');
            
            // 使用多种选择器尝试查找登录按钮
            const buttonSelectors = [
                '#loginbtn',
                'button[type="submit"]',
                'input[type="submit"]',
                '.login-button',
                '.submit-button',
                '.btn-login',
                'button.ant-btn-primary',
                '.ant-btn-primary',
                'button:not([disabled])'
            ];

            let loginButton: ElementHandle<HTMLElement> | null = null;
            
            // 尝试所有选择器
            for (const selector of buttonSelectors) {
                console.log(`尝试使用选择器: ${selector}`);
                loginButton = await this.page.$(selector) as ElementHandle<HTMLElement> | null;
                if (loginButton) {
                    console.log(`使用选择器 ${selector} 找到登录按钮`);
                    break;
                }
            }

            // 如果选择器方法失败，尝试 XPath
            if (!loginButton) {
                console.log('尝试使用 XPath 查找登录按钮...');
                const xpathQueries = [
                    '//*[@id="loginbtn"]',
                    '//button[contains(text(), "登录")]',
                    '//button[contains(text(), "提交")]',
                    '//input[@type="submit"]',
                    '//button[contains(@class, "login")]',
                    '//button[contains(@class, "submit")]'
                ];

                for (const xpath of xpathQueries) {
                    console.log(`尝试 XPath: ${xpath}`);
                    const elements = await this.page.$x(xpath);
                    if (elements.length > 0) {
                        loginButton = elements[0] as ElementHandle<HTMLElement>;
                        console.log(`使用 XPath ${xpath} 找到登录按钮`);
                        break;
                    }
                }
            }

            // 如果仍然找不到按钮，尝试使用 evaluate
            if (!loginButton) {
                console.log('尝试使用 evaluate 查找登录按钮...');
                const buttonInfo = await this.page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                    return buttons.map(button => ({
                        text: button.textContent || button.getAttribute('value'),
                        type: button instanceof HTMLButtonElement ? button.type : (button as HTMLInputElement).type,
                        class: button.className,
                        id: button.id,
                        isVisible: (button as HTMLElement).offsetParent !== null,
                        disabled: button instanceof HTMLButtonElement ? button.disabled : button instanceof HTMLInputElement ? button.disabled : false,
                        rect: button.getBoundingClientRect(),
                        attributes: Array.from(button.attributes).map(attr => ({
                            name: attr.name,
                            value: attr.value
                        }))
                    }));
                });
                console.log('页面上的所有按钮信息:', JSON.stringify(buttonInfo, null, 2));

                // 尝试找到一个可能的登录按钮
                const handle = await this.page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                    return buttons.find(button => {
                        const text = (button.textContent || button.getAttribute('value') || '').toLowerCase();
                        const isVisible = (button as HTMLElement).offsetParent !== null;
                        const isEnabled = !(button instanceof HTMLButtonElement ? button.disabled : button instanceof HTMLInputElement ? button.disabled : false);
                        return isVisible && isEnabled && (
                            text.includes('登录') ||
                            text.includes('提交') ||
                            text.includes('login') ||
                            text.includes('submit')
                        );
                    }) || null;
                });

                if (handle) {
                    const element = await handle.asElement();
                    if (element) {
                        loginButton = element as ElementHandle<HTMLElement>;
                        console.log('使用 evaluate 找到可能的登录按钮');
                    }
                    await handle.dispose();
                }
            }

            if (!loginButton) {
                throw new Error('未找到登录按钮，请检查页面结构');
            }

            console.log('找到登录按钮，准备点击...');
            
            // 确保按钮在视图中并且可点击
            await this.page.evaluate((button) => {
                if (button instanceof HTMLElement) {
                    button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, loginButton);
            
            await this.page.waitForTimeout(1000); // 等待滚动完成

            try {
                await loginButton.click();
                console.log('已点击登录按钮');
            } catch (error) {
                console.error('直接点击登录按钮失败:', error);
                // 尝试使用 evaluate 方式点击
                await this.page.evaluate(button => {
                    if (button instanceof HTMLElement) {
                        button.click();
                        console.log('使用 evaluate 方式点击登录按钮成功');
                    }
                }, loginButton).catch(evalError => {
                    throw new Error(`无法点击登录按钮: ${evalError.message}`);
                });
            }

            // 7. 等待登录完成
            console.log('等待登录完成...');
            await this.page.waitForNavigation({ timeout: 30000 })
                .catch(() => { throw new Error('登录超时'); });

            console.log('登录成功');
            return { success: true };
        } catch (error) {
            console.error('登录失败:', error);
            // 保存页面截图以便调试
            try {
                const screenshotPath = 'login-error.png';
                await this.page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`已保存错误页面截图到 ${screenshotPath}`);
            } catch (screenshotError) {
                console.error('保存截图失败:', screenshotError);
            }
            return {
                success: false,
                error: `登录失败: ${error instanceof Error ? error.message : '未知错误'}`
            };
        }
    }
} 