import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
export class UdtInfo {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "varchar" })
  @Index({ unique: true })
  hash: string;

  /* === Token type script === */
  @Column({ type: "varchar" })
  typeCodeHash: string;

  @Column({ type: "varchar" })
  typeHashType: string;

  @Column({ type: "text" })
  typeArgs: string;
  /* === Token type script === */

  @Column({ type: "text", nullable: true })
  name: string | null;

  @Column({ type: "text", nullable: true })
  symbol: string | null;

  @Column({ type: "int", nullable: true })
  decimals: number | null;

  @Column({ type: "text", nullable: true })
  icon: string | null;

  @Column({ type: "text", nullable: true })
  owner: string | null;

  /* === Statistic fields === */
  @Column({ type: "varchar" })
  firstIssuanceTxHash: string;

  @Column({ type: "varchar" })
  totalSupply: string;

  @Column({ type: "varchar" })
  circulatingSupply: string;
  /* === Statistic fields === */

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity()
export class UdtInfoPending extends UdtInfo {}
