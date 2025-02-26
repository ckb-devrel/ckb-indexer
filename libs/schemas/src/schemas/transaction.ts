import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
export class Transaction {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "varchar" })
  @Index({ unique: true })
  txHash: string;

  @Column({ type: "mediumblob" })
  tx: Buffer;

  // To provide evidence for data cleanup, this table won't be rolled back on re-org
  @Column({ type: "varchar" })
  updatedAtHeight: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
