import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { MediaService } from './media.service';

interface MediaUploadRequest {
  fileType: string;
}

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // Get S3 presigned URL for media uploading
  @Post()
  async createUploadUrl(@Body() body: MediaUploadRequest, @Res() res: Response) {
    const { fileType } = body;
    if (!['jpg', 'jpeg', 'png'].includes(fileType)) {
      res.status(400).json({ error: `Unsupported file type ${fileType}` });
      return;
    }
    try {
      const result = await this.mediaService.createUploadUrl(fileType);
      res.status(200).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }

  // Get S3 presigned URL for loading media in the message thread
  @Get('presigned')
  getPresignedViewUrl(@Query('key') key: string, @Res() res: Response) {
    try {
      const result = this.mediaService.getPresignedViewUrl(key);
      res.status(200).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }
}
