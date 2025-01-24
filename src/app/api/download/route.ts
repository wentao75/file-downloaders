import { NextResponse } from 'next/server';
import { JulivesDownloader } from '@/lib/downloaders/julives-downloader';
import { config } from 'dotenv';
import path from 'path';

// 加载环境变量
config({ path: path.resolve(process.cwd(), '.env.local') });

interface RequestBody {
    date: string;
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}${error.stack ? '\n' + error.stack : ''}`;
    } else if (error && typeof error === 'object') {
        if ('message' in error) {
            return String((error as { message: unknown }).message);
        }
        try {
            return JSON.stringify(error, null, 2);
        } catch {
            return String(error);
        }
    }
    return String(error);
}

export async function POST(request: Request) {
    const logs: string[] = [];
    let downloader: JulivesDownloader | null = null;

    // 先读取请求体
    let targetDate: Date;
    try {
        const { date } = await request.json() as RequestBody;
        targetDate = date ? new Date(date) : new Date(Date.now() - 86400000);
    } catch (error) {
        return NextResponse.json({
            success: false,
            logs: ['请求解析失败'],
            error: formatError(error)
        }, { status: 400 });
    }
    
    try {
        logs.push('初始化下载器...');
        
        downloader = new JulivesDownloader();
        const initResult = await downloader.init().catch(error => {
            throw new Error(`浏览器初始化失败: ${formatError(error)}`);
        });

        if (!initResult) {
            throw new Error('浏览器初始化失败');
        }
        
        logs.push('开始下载流程...');
        const result = await downloader.downloadDailyReport(targetDate);
        
        if (result.success) {
            logs.push(result.message || `文件已保存到: ${result.filePath}`);
            logs.push('清理资源...');
            await downloader.close();
            
            return NextResponse.json({
                success: true,
                logs
            });
        } else {
            throw new Error(result.error || '下载失败');
        }
    } catch (error) {
        console.error('下载失败:', error);
        const errorMessage = formatError(error);
        logs.push(`错误: ${errorMessage}`);
        
        if (downloader) {
            try {
                await downloader.close();
            } catch (closeError) {
                console.error('关闭下载器时出错:', closeError);
            }
        }
        
        return NextResponse.json({
            success: false,
            logs,
            error: errorMessage
        }, { status: 500 });
    }
} 