import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../../common/database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UsersService } from './users.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { AuthGuard } from './auth.guard.js';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) {
          throw new Error(
            'JWT_SECRET must be set to a string of at least 32 characters',
          );
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersService,
    PasswordService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [UsersService, TokenService],
})
export class AuthModule {}
