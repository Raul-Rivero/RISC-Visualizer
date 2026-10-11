export type Example = { name: string; source: string };

const SUM_INDEXED = `# main builds int arr[5] on its own stack frame,
# then calls sum_indexed(arr, 5). Result comes back in a0.
main:
	addi	sp,sp,-32
	sw	ra,28(sp)
	li	t0,3
	sw	t0,0(sp)
	li	t0,7
	sw	t0,4(sp)
	li	t0,-2
	sw	t0,8(sp)
	li	t0,10
	sw	t0,12(sp)
	li	t0,4
	sw	t0,16(sp)
	mv	a0,sp
	li	a1,5
	call	sum_indexed
	lw	ra,28(sp)
	addi	sp,sp,32
	jr	ra

sum_indexed:
	addi	sp,sp,-48
	sw	s0,44(sp)
	addi	s0,sp,48
	sw	a0,-36(s0)
	sw	a1,-40(s0)
	sw	zero,-20(s0)
	sw	zero,-24(s0)
	j	.L2
.L3:
	lw	a5,-24(s0)
	slli	a5,a5,2
	lw	a4,-36(s0)
	add	a5,a4,a5
	lw	a5,0(a5)
	lw	a4,-20(s0)
	add	a5,a4,a5
	sw	a5,-20(s0)
	lw	a5,-24(s0)
	addi	a5,a5,1
	sw	a5,-24(s0)
.L2:
	lw	a4,-24(s0)
	lw	a5,-40(s0)
	blt	a4,a5,.L3
	lw	a5,-20(s0)
	mv	a0,a5
	lw	s0,44(sp)
	addi	sp,sp,48
	jr	ra
`;

const FACTORIAL = `# Recursive factorial: watch the stack grow one frame per call
main:
	addi	sp,sp,-16
	sw	ra,12(sp)
	li	a0,4
	call	fact
	lw	ra,12(sp)
	addi	sp,sp,16
	ret

# int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
fact:
	addi	sp,sp,-16
	sw	ra,12(sp)
	sw	s0,8(sp)
	addi	s0,sp,16
	sw	a0,-12(s0)
	li	t0,1
	bgt	a0,t0,.Lrecurse
	li	a0,1
	j	.Ldone
.Lrecurse:
	addi	a0,a0,-1
	call	fact
	lw	t1,-12(s0)
	mul	a0,a0,t1
.Ldone:
	lw	ra,12(sp)
	lw	s0,8(sp)
	addi	sp,sp,16
	ret
`;

const SWAP = `# swap(int *a, int *b) using a global array in .data
	.data
nums:	.word	11, 22

	.text
main:
	addi	sp,sp,-16
	sw	ra,12(sp)
	la	a0,nums
	addi	a1,a0,4
	call	swap
	lw	ra,12(sp)
	addi	sp,sp,16
	ret

swap:
	lw	t0,0(a0)
	lw	t1,0(a1)
	sw	t1,0(a0)
	sw	t0,0(a1)
	ret
`;

export const EXAMPLES: Example[] = [
  { name: 'sum_indexed (array on stack)', source: SUM_INDEXED },
  { name: 'Recursive factorial', source: FACTORIAL },
  { name: 'Swap via .data', source: SWAP },
];
