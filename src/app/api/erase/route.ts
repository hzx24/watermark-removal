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

// 获取并修复 URL 协议，并确保它是可以通过阿里云内网验证的格式
async function getSafeUrl(base64Data: string, prefix: string, accessKeyId: string, accessKeySecret: string): Promise<string> {
  // 如果已经是之前处理过的阿里云链接，直接使用
  if (base64Data.startsWith('http')) {
    return base64Data;
  }

  // 1. 将前端传来的 base64 图片保存为服务器临时文件
  const filePath = base64ToTempFile(base64Data, prefix);
  
  try {
    // 2. 使用 viapi-utils 将文件上传到阿里云专门用于视觉智能 API 的上海临时 OSS 中
    let uploadUrl = await viapiUtils.upload(accessKeyId, accessKeySecret, filePath);
    
    // 3. 强制修复在 Vercel 环境下常见的 undefined:// 协议头 Bug
    if (uploadUrl.startsWith('undefined://')) {
      uploadUrl = uploadUrl.replace('undefined://', 'http://');
    }
    
    // 清理临时文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return uploadUrl;
  } catch (error) {
    // 清理临时文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const { image, mask } = await req.json();

    if (!image || !mask) {
      return NextResponse.json({ error: '缺少图片或遮罩数据' }, { status: 400 });
    }

    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

    if (!accessKeyId || !accessKeySecret) {
      return NextResponse.json({ error: '服务器未配置阿里云密钥' }, { status: 500 });
    }

    console.log("正在处理并上传图片到阿里云临时上海 OSS...");
    
    // 核心修复点：我们使用 viapi-utils 官方包进行上传。
    // 因为这个包会将图片上传到专属于当前用户的“上海临时 OSS Bucket”中。
    // 这完美符合阿里云 "非上海 OSS 图片链接非法" 的硬性要求。
    const finalImageUrl = await getSafeUrl(image, 'image', accessKeyId, accessKeySecret);
    const finalMaskUrl = await getSafeUrl(mask, 'mask', accessKeyId, accessKeySecret);

    console.log("上传成功，准备调用 ErasePerson API...");
    console.log("ImageURL:", finalImageUrl);
    console.log("UserMask:", finalMaskUrl);

    // 初始化阿里云 RPC 客户端
    const client = new Core({
      accessKeyId: accessKeyId,
      accessKeySecret: accessKeySecret,
      endpoint: 'https://imageenhan.cn-shanghai.aliyuncs.com',
      apiVersion: '2019-09-30',
    });

    const params = {
      "ImageURL": finalImageUrl,
      "UserMask": finalMaskUrl
    };

    // 关键：为了解决部分大图导致的 ReadTimeout 报错，我们将超时时间提升到 30 秒！
    const requestOption = {
      method: 'POST' as const,
      formatParams: false,
      timeout: 30000 // 增加到 30 秒
    };

    // 发送请求给阿里云
    const result: any = await client.request('ErasePerson', params, requestOption);
    console.log("阿里云 API 返回结果:", JSON.stringify(result, null, 2));

    if (result && result.Data && result.Data.ImageUrl) {
      return NextResponse.json({ url: result.Data.ImageUrl });
    } else {
      return NextResponse.json({ error: '处理失败，未返回图片地址', rawResponse: result }, { status: 500 });
    }

  } catch (error: any) {
    console.error("处理过程中报错:", error);
    const errorMsg = error.data ? JSON.stringify(error.data) : error.message;
    return NextResponse.json({ error: errorMsg || '内部服务器错误' }, { status: 500 });
  }
}
