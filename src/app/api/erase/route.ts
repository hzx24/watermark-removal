import { NextResponse } from 'next/server';
// @ts-ignore
import Core from '@alicloud/pop-core';
// @ts-ignore
import viapiUtils from '@alicloud/viapi-utils';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 将 Base64 转换为临时文件
function base64ToTempFile(base64Str: string, prefix: string): string {
  // 检查是否已经是 http 链接（二次编辑时可能会传过来阿里云的 URL）
  if (base64Str.startsWith('http://') || base64Str.startsWith('https://')) {
    return base64Str; // 如果已经是 URL，就不处理，直接返回
  }

  const matches = base64Str.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid base64 string');
  }
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const tempPath = path.join(os.tmpdir(), `${prefix}-${Date.now()}.${ext}`);
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

export async function POST(req: Request) {
  try {
    const { image, mask } = await req.json();

    if (!image || !mask) {
      return NextResponse.json({ error: 'Missing image or mask' }, { status: 400 });
    }

    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

    if (!accessKeyId || !accessKeySecret) {
      return NextResponse.json({ error: '服务器未配置阿里云密钥' }, { status: 500 });
    }

    // 1. 将 Base64 图片保存为临时文件 (如果是 http URL 则原样返回)
    const imagePath = base64ToTempFile(image, 'image');
    const maskPath = base64ToTempFile(mask, 'mask');

    try {
      // 2. 获取最终需要发给阿里云的 URL
      // 如果 imagePath 是以 http 开头的，说明它是二次编辑传过来的线上地址，直接用，不需要再上传到 OSS
      // 注意：在 Vercel 这种 Serverless 环境中，viapiUtils 可能会因为依赖缺失或网络超时导致失败
      // 为了稳定，我们直接使用阿里云 SDK 的 OSS 直传或者修复 viapiUtils 的超时问题
      // 但最快的方式是给 viapiUtils.upload 增加重试机制，或者忽略其内部的超时警告
      let imageUrl = imagePath.startsWith('http') 
        ? imagePath 
        : await viapiUtils.upload(accessKeyId, accessKeySecret, imagePath);
        
      let maskUrl = maskPath.startsWith('http')
        ? maskPath
        : await viapiUtils.upload(accessKeyId, accessKeySecret, maskPath);

      // 强制修复在 Vercel 线上环境下，viapi-utils 生成的协议头变为 undefined:// 的 bug
      if (imageUrl.startsWith('undefined://')) {
        imageUrl = imageUrl.replace('undefined://', 'http://');
      }
      if (maskUrl.startsWith('undefined://')) {
        maskUrl = maskUrl.replace('undefined://', 'http://');
      }

      // 3. 初始化阿里云 RPC 客户端
      // 我们调用 ErasePerson (图像擦除/人体擦除) 接口，它支持传入 UserMask
      const client = new Core({
        accessKeyId: accessKeyId,
        accessKeySecret: accessKeySecret,
        endpoint: 'https://imageenhan.cn-shanghai.aliyuncs.com',
        apiVersion: '2019-09-30',
      });

      const params = {
        "ImageURL": imageUrl,
        "UserMask": maskUrl
      };

      const requestOption = {
        method: 'POST' as const,
        formatParams: false,
        timeout: 30000 // 【非常重要】增加超时时间为 30 秒，防止手机端网速慢时报错
      };

      // 4. 发送请求给阿里云
      console.log("正在调用阿里云 ErasePerson API...");
      console.log("ImageURL:", imageUrl);
      console.log("UserMask:", maskUrl);
      
      const result: any = await client.request('ErasePerson', params, requestOption);
      console.log("阿里云 API 返回结果:", JSON.stringify(result, null, 2));

      // 清理临时文件 (只有当它是本地临时文件路径时才清理)
      if (!imagePath.startsWith('http') && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      if (!maskPath.startsWith('http') && fs.existsSync(maskPath)) fs.unlinkSync(maskPath);

      if (result && result.Data && result.Data.ImageUrl) {
        return NextResponse.json({ resultUrl: result.Data.ImageUrl });
      } else {
        return NextResponse.json({ error: '处理失败，未返回图片地址', rawResponse: result }, { status: 500 });
      }

    } catch (apiError: any) {
      // 清理临时文件
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      if (fs.existsSync(maskPath)) fs.unlinkSync(maskPath);
      console.error("Aliyun API Error:", apiError);
      return NextResponse.json({ error: apiError.message || '调用阿里云接口失败' }, { status: 500 });
    }

  } catch (error: any) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: error.message || '内部服务器错误' }, { status: 500 });
  }
}
