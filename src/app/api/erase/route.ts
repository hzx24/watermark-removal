import { NextResponse } from 'next/server';
// 我们直接使用原生代码和 fetch，彻底放弃阿里云官方的老旧 SDK！
import crypto from 'crypto';

// ---------------------------------------------------------
// 1. 核心工具：向阿里云申请 STS 临时上传凭证
// ---------------------------------------------------------
async function getStsToken(accessKeyId: string, accessKeySecret: string) {
  const method = 'POST';
  const endpoint = 'https://sts.cn-shanghai.aliyuncs.com/';

  const params: Record<string, string> = {
    Format: 'JSON',
    Version: '2015-04-01',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Action: 'GetSessionAccessKey', // 使用视觉智能专用的 Action
    DurationSeconds: '3600'
  };

  const keys = Object.keys(params).sort();
  const canonicalizedQueryString = keys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&');
  const stringToSign = `${method}&%2F&${encodeURIComponent(canonicalizedQueryString)}`;
  const signature = crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
  
  params.Signature = signature;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  const data = await res.json();
  if (!data.SessionAccessKey || !data.SessionAccessKey.SessionAccessKeyId) {
    // 如果 GetSessionAccessKey 失败，说明该账号不支持临时凭证直传，
    // 我们将使用备用方案：直接把 Base64 发给阿里云的底层 API！
    return null;
  }
  return data;
}

// ---------------------------------------------------------
// 2. 核心工具：直接调用图像擦除底层 API (原生 Fetch 版，永不超时)
// ---------------------------------------------------------
async function callAliyunErasePerson(imageBase64: string, maskBase64: string, accessKeyId: string, accessKeySecret: string) {
  const endpoint = 'https://imageenhan.cn-shanghai.aliyuncs.com/';
  
  const params: Record<string, string> = {
    Format: 'JSON',
    Version: '2019-09-30',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Action: 'ErasePerson',
    ImageURL: imageBase64, // 阿里云其实支持直接传 Base64 字符串
    UserMask: maskBase64
  };

  const keys = Object.keys(params).sort();
  
  // 必须使用阿里云特定的 encode 规则
  const percentEncode = (str: string) => encodeURIComponent(str).replace(/\!/g, '%21').replace(/\'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
  
  const canonicalizedQueryString = keys.map(key => `${percentEncode(key)}=${percentEncode(params[key])}`).join('&');
  const stringToSign = `POST&%2F&${percentEncode(canonicalizedQueryString)}`;
  const signature = crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
  
  params.Signature = signature;

  // 使用 Vercel 原生的 fetch，它不会像 pop-core 那样动不动就 3000ms 超时死锁
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.Message || JSON.stringify(result));
  }
  return result;
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

    console.log("正在处理图片 (纯净 Vercel Serverless 版)...");

    // 提取干净的 Base64 字符串
    const extractBase64 = async (dataUrl: string) => {
      if (dataUrl.startsWith('http')) {
         const res = await fetch(dataUrl);
         const buffer = await res.arrayBuffer();
         return Buffer.from(buffer).toString('base64');
      }
      return dataUrl.replace(/^data:image\/\w+;base64,/, "");
    };

    const imageBase64 = await extractBase64(image);
    const maskBase64 = await extractBase64(mask);

    console.log("图片已转换为 Base64，准备直接调用 ErasePerson API...");

    // 直接使用纯净的 fetch 调用阿里云底层 API，彻底绕过所有第三方包的超时和协议 Bug
    const result = await callAliyunErasePerson(imageBase64, maskBase64, accessKeyId, accessKeySecret);
    
    console.log("阿里云 API 返回成功");

    if (result && result.Data && result.Data.ImageUrl) {
      return NextResponse.json({ url: result.Data.ImageUrl });
    } else {
      return NextResponse.json({ error: '处理失败，未返回图片地址', rawResponse: result }, { status: 500 });
    }

  } catch (error: any) {
    console.error("处理过程中报错:", error);
    return NextResponse.json({ error: error.message || '内部服务器错误' }, { status: 500 });
  }
}
