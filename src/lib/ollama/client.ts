import axios from 'axios';

export interface AnalyzeResponse {
    result: string;
    confidence: number;
}

export class OllamaClient {
    private baseUrl: string;
    private model: string;

    constructor(baseUrl: string = 'http://localhost:11434', model: string = 'llama2') {
        this.baseUrl = baseUrl;
        this.model = model;
    }

    async generate(prompt: string): Promise<string> {
        try {
            const response = await axios.post(`${this.baseUrl}/api/generate`, {
                model: this.model,
                prompt: prompt,
                stream: false
            });
            return response.data.response;
        } catch (error) {
            console.error('Ollama API error:', error);
            throw new Error('Failed to generate response from Ollama');
        }
    }

    async analyze(input: string, context: string): Promise<AnalyzeResponse> {
        const prompt = `
        Context: ${context}
        Input: ${input}
        
        Please analyze the input based on the context and provide a structured response.
        `;
        
        const response = await this.generate(prompt);
        return {
            result: response,
            confidence: 1.0 // 这里可以根据实际情况调整置信度计算
        };
    }
} 