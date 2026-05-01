# cards.py
import hashlib
import random
import sympy
import secrets
from decimal import Decimal, getcontext

def cards_encoding(value):
    if value <= 13:
        return [0,1,3,6,10,15,21,28,36,45,55,66,78,91][value]
    return value

def joker(lenght=16):
    return secrets.token_hex(lenght)

def seperating_and_encoding(value):
    return [cards_encoding(int(d)) for d in str(value)]

def int_to_bytes(n):
    return n.to_bytes((n.bit_length() + 7) // 8 or 1, 'big')

def compute_pi(digits):
    getcontext().prec = digits + 2
    C = 426880 * Decimal(10005).sqrt()
    M = Decimal(1)
    L = Decimal(13591409)
    X = Decimal(1)
    K = Decimal(6)
    S = L

    for i in range(1, digits):
        M = (M * (K**3 - 16*K)) / (Decimal(i)**3)
        L += 545140134
        X *= -262537412640768000
        S += M * L / X
        K += 12

    return str(C / S)

def generate_final_key(passcode, joker_value):
    all_encoded_digits = []
    combined_input = passcode+joker_value

    for char in passcode:
        all_encoded_digits.extend(seperating_and_encoding(ord(char)))

    seed = int.from_bytes(hashlib.sha256(combined_input.encode()).digest(), 'big')
    rng = random.Random(seed)
    rng.shuffle(all_encoded_digits)

    d = sum(all_encoded_digits)
    prime_factor = sympy.nextprime(seed % 10000 + 1000)
    M = d * prime_factor

    merged_shuffling = int("".join(map(str, all_encoded_digits)))
    mask = (1 << 32) - 1

    J_seed = ~(merged_shuffling | M) & mask
    hash_value = hashlib.sha256(int_to_bytes(J_seed)).hexdigest()
    hex_num = int(hash_value, 16)

    last_digit = hex_num % 10
    segment_length = max(5, last_digit)
    pi_offset = sum(int(d) for d in str(hex_num % (10 ** segment_length)))

    pi_digits = compute_pi(pi_offset + segment_length + 2).split(".")[1]
    pi_segment = pi_digits[pi_offset:pi_offset + segment_length]

    final_key_seed = ~(merged_shuffling | int(pi_segment)) & mask
    return hashlib.sha256(int_to_bytes(final_key_seed)).hexdigest()
