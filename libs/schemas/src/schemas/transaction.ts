import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
@Index(["txHash", "updatedAtHeight", "blockHash"], { unique: true })
export class Transaction {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "varchar" })
  @Index({ unique: true })
  txHash: string;

  @Column({ type: "varchar" })
  blockHash: string;

  @Column({ type: "int" })
  txIndex: number;

  @Column({ type: "mediumtext" })
  tx: string;

  // To roll back on re-org
  @Column({ type: "varchar" })
  @Index()
  updatedAtHeight: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
