import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
    }

    // 在服务端去请求阿里云的图片，这样就不会有浏览器的 CORS 跨域限制
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const imageBuffer = await response.arrayBuffer();

    // 把图片 Buffer 封装成可以下载的响应
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
        'Content-Disposition': `attachment; filename="no-watermark-${Date.now()}.jpg"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('Proxy Download Error:', error);
    return NextResponse.json({ error: '下载图片时发生错误' }, { status: 500 });
  }
}
