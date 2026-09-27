import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import type { Request } from 'express';
import { SkipPermissions } from '../../modules/auth/permissions/decorators/skip-permissions.decorator.js';
import { MediaService } from './media.service.js';

const imageFileFilter = (_req: any, file: any, callback: any) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
    return callback(
      new BadRequestException('Chỉ chấp nhận các tệp hình ảnh (.jpg, .jpeg, .png, .webp, .gif, .svg)!'),
      false,
    );
  }
  callback(null, true);
};

const storageConfig = diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, join(process.cwd(), 'uploads'));
  },
  filename: (_req, file, cb) => {
    const randomSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = extname(file.originalname).toLowerCase();
    const cleanBase = file.originalname
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    cb(null, `${cleanBase}-${randomSuffix}${ext}`);
  },
});

@ApiTags('Media & Uploads')
@ApiBearerAuth('access-token')
@SkipPermissions()
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload một hình ảnh (avatar, ảnh gói khám, ảnh cơ sở...)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: storageConfig,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: imageFileFilter,
    }),
  )
  uploadSingle(@UploadedFile() file: any, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn một tệp hình ảnh để tải lên');
    }
    return this.mediaService.formatUploadResult(file, req);
  }

  @Post('upload-multiple')
  @ApiOperation({ summary: 'Upload nhiều hình ảnh cùng lúc' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: storageConfig,
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: imageFileFilter,
    }),
  )
  uploadMultiple(@UploadedFiles() files: any[], @Req() req: Request) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một tệp hình ảnh để tải lên');
    }
    return {
      success: true,
      items: files.map((file) => this.mediaService.formatUploadResult(file, req)),
    };
  }
}
