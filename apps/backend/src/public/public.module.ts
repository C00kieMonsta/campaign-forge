import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { PublicController } from "./public.controller";

@Module({
  imports: [ContactsModule],
  controllers: [PublicController],
})
export class PublicModule {}
