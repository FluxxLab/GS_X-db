import { PrimaryGeneratedColumn, Column, Entity, Unique} from "typeorm";

@Entity('session_bookmarks')
@Unique('uq_bookmark_delegate_session', ['delegateId', 'sessionId'])
export class SessionBookmark{
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({type: 'uuid'})
    delegateId: string;

    @Column({type: 'uuid'})
    sessionId: string;

    @Column({type: 'timestamptz'})
    createdAt: Date;

}