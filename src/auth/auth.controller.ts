
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../common/decorators/public.decorator';
import { RegisterDto } from './dto/register.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { OtpService } from './otp.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthUser } from './strategies/jwt.stategies';
import {Redis} from "ioredis";
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { VerifyPassDto } from './dto/verify-pass.dto';


@ApiTags('Auth')
@Controller('auth')
export class AuthController{

    constructor(
        private readonly authService: AuthService,
        private readonly otpService: OtpService,
        private readonly redis: Redis,
    ){}


    @Public()
    @Post('login')
    @HttpCode(200)
    @ApiOperation({
        summary: "Login"
    })
    @ApiResponse({
        status: 200,
        description: "Login successful"
    })
    async login(@Body() dto: LoginDto, @Req() req: Request ){
        return this.authService.login(dto.email, dto.password, {
            userAgent: req.headers['user-agent'],
            ip: req.ip,
        });
    }

    @Public()
    @Post('refresh')
    @HttpCode(200)
    @ApiOperation({
        summary: "Refresh Token"
    })
    @ApiResponse({
        status: 200,
        description: "Token refreshed successfully"
    })
    refresh(@Body() dto: RefreshDto, @Req() req: Request){

        return this.authService.refresh(dto.refreshToken, {
            userAgent: req.headers['user-agent'],
            ip: req.ip,
        });
    }

    @Public()
    @Post('register')
    @ApiOperation({summary: 'Self registration with tier verification (scope addition)'})
    register(@Body() dto: RegisterDto, @Req() req: Request){
        return this.authService.registration(dto,{
            userAgent: req.headers['user-agent'],
            ip: req.ip,
        })
    }

    @Public()
    @Post('register/request-otp')
    @HttpCode(200)
    @ApiOperation({
        summary: 'Step 1 of Registration - Request OTP SMS/Email'
    })
    @ApiResponse({
        status: 204,
        description: 'OTP request successful'
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid request or user already exists'
    })
    @ApiResponse({
        status: 429,
        description: 'Too many requests'
    })
    async requestOtp(@Body() dto: RequestOtpDto){
        await this.otpService.requestOtp(dto.email,dto.channel, dto.phone);
    }

    @Post('logout')
    @HttpCode(204)
    @ApiOperation({
        summary: 'Revoke refresh token + blacklist the presentend access token'
    })
    async logout(@Body() dto: RefreshDto, @CurrentUser() user: AuthUser){
        await this.authService.logout(dto.refreshToken,user.jti, user.exp);
    }

    @Get('pass')
    @ApiOperation({summary: 'Short-lived QR pass for the caller'})
    pass(@CurrentUser() user: AuthUser){
        return this.authService.issuePass(user.id);
    }

    @Post('verify-pass')
    @Roles(AccessTier.ADMIN)
    @HttpCode(200)
    @ApiOperation({summary: 'Gate scanner: verify a scanned pass'})
    verifyPass(@Body() dto: VerifyPassDto){
        return this.authService.varifyPass(dto.pass);
    }

}