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
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { SkipPermissions } from 'src/common/decorators';
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

const storageConfig = memoryStorage();

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
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: imageFileFilter,
    }),
  )
  async uploadSingle(@UploadedFile() file: any, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn một tệp hình ảnh để tải lên');
    }
    return await this.mediaService.saveFile(file, req);
  }

  @Post('upload-multiple')
  @ApiOperation({ summary: 'Upload nhiều hình ảnh cùng lúc' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: storageConfig,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: imageFileFilter,
    }),
  )
  async uploadMultiple(@UploadedFiles() files: any[], @Req() req: Request) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một tệp hình ảnh để tải lên');
    }
    const items = await Promise.all(
      files.map((file) => this.mediaService.saveFile(file, req)),
    );
    return {
      success: true,
      items,
    };
  }
}
