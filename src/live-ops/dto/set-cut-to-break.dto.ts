import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class SetCutToBreakDto {
    @ApiProperty({description: 'true = cut all streams to break screen'})
    @IsBoolean()
    active:boolean;
}