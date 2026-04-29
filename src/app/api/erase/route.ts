import { NextResponse } from 'next/server';
// @ts-ignore
import Core from '@alicloud/pop-core';
import fs from 'fs';
import path from 'path';
import os from 'os';
// 引入阿里云临时上传所需的底层依赖
// @ts-ignore
import * as RPCClient from '@alicloud/rpc-client';
// @ts-ignore
import viapiutils20200401, { GetOssStsTokenRequest } from '@alicloud/viapiutils20200401';
// @ts-ignore
import * as OSSClient from '@alicloud/oss-client';
// @ts-ignore
import { RuntimeOptions } from '@alicloud/oss-util';

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

// 自定义上传函数，解决 Vercel 下 viapi-utils 的 3000ms 超时和 undefined:// 协议头 Bug
async function uploadToAliyunTemp(accessKeyId: string, accessKeySecret: string, filePath: string): Promise<string> {
  // 1. 获取 STS Token
  const viConfig = new RPCClient.Config({
    accessKeyId,
    accessKeySecret,
    type: "access_key",
    endpoint: "viapiutils.cn-shanghai.aliyuncs.com",
    regionId: "cn-shanghai",
  });
  const viclient = new viapiutils20200401(viConfig);
  const viRequest = new GetOssStsTokenRequest({});
  const viResponse = await viclient.getOssStsToken(viRequest);

  if (!viResponse || !viResponse.data) {
    throw new Error("Failed to get STS token from Aliyun");
  }

  // 2. 构造 OSS 客户端
  const ossConfig = new OSSClient.Config({
    accessKeyId: viResponse.data.accessKeyId,
    accessKeySecret: viResponse.data.accessKeySecret,
    securityToken: viResponse.data.securityToken,
    type: "sts",
    endpoint: "oss-cn-shanghai.aliyuncs.com",
    regionId: "cn-shanghai",
  });
  const ossClient = new OSSClient.default(ossConfig);

  // 3. 准备上传
  const fileName = path.basename(filePath);
  const objectName = `${accessKeyId}/${Date.now()}-${Math.floor(Math.random()*10000)}-${fileName}`;
  const ins = fs.createReadStream(filePath);
  
  const uploadRequest = new OSSClient.PutObjectRequest({
    bucketName: "viapi-customer-temp",
    body: ins,
    objectName: objectName,
  });

  // 这里的核心：覆盖默认的 3000ms 超时限制！Vercel 免费版函数上限通常是 10s，我们给 30s 宽限
  const ossRuntime = new RuntimeOptions({
    readTimeout: 30000,
    connectTimeout: 30000,
  });

  await ossClient.putObject(uploadRequest, ossRuntime);
  
  return `http://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/${objectName}`;
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
      // 注意：在 Vercel 这种 Serverless 环境中，由于网络环境差异导致上传容易超时，我们改用自定义的上传逻辑
      const imageUrl = imagePath.startsWith('http') 
        ? imagePath 
        : await uploadToAliyunTemp(accessKeyId, accessKeySecret, imagePath);
        
      const maskUrl = maskPath.startsWith('http')
        ? maskPath
        : await uploadToAliyunTemp(accessKeyId, accessKeySecret, maskPath);

      // 由于 viapiUtils.upload 内部实现有些老旧，在 Vercel 线上环境可能会返回缺少 http/https 协议头的 URL
      // 例如： undefined://viapi-customer-temp.oss-cn-shanghai... 
      // 我们在这里强制修复这个 URL 协议头
      const fixUrlProtocol = (url: string) => {
        if (url.startsWith('undefined://')) {
          return url.replace('undefined://', 'http://');
        }
        return url;
      };

      const finalImageUrl = fixUrlProtocol(imageUrl);
      const finalMaskUrl = fixUrlProtocol(maskUrl);

      // 3. 初始化阿里云 RPC 客户端
      // 我们调用 ErasePerson (图像擦除/人体擦除) 接口，它支持传入 UserMask
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

      const requestOption = {
        method: 'POST',
        formatParams: false,
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
