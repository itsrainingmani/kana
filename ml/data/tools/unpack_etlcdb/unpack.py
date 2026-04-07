import codecs
import bitstring
from PIL import Image
import jaconv
from dataclasses import dataclass

def T56(c):
    t56s = '0123456789[#@:>? ABCDEFGHI&.](<  JKLMNOPQR-$*);\'|/STUVWXYZ ,%="!'
    return t56s[c]

class CO59_to_unicode:
    def __init__(self, euc_co59_file='euc_co59.dat'):
        with codecs.open(euc_co59_file, 'r', 'euc-jp') as f:
            co59t = f.read()
        co59l = co59t.split()
        self.conv = {}
        for c in co59l:
            ch = c.split(':')
            co = ch[1].split(',')
            co59c = (int(co[0]), int(co[1]))
            self.conv[co59c] = ch[0]

    def __call__(self, co59):
        return self.conv[co59]

co59_to_unicode = CO59_to_unicode('euc_co59.dat')

@dataclass
class RecordType:
    length_in_octets: int
    fields: dict
    converters: dict

    def read(this, filename, skip_first=False):
        bs = ','.join(this.fields.values())
        keys = [ k for k, v in this.fields.items() if 'pad' not in v ]
        records = []
        with open(filename, 'rb') as file:
            while chunk := file.read(this.length_in_octets):
                if skip_first:
                    skip_first = False
                    continue
                s = bitstring.ConstBitStream(bytes=chunk)
                if len(chunk) != this.length_in_octets:
                    print("Warning: Incomplete record detected, skipping.")
                    continue
                record = dict(zip(keys, s.unpack(bs)))
                for k, v in this.converters.items():
                    try:
                        record[k] = v(record)
                    except Exception as e:
                        print(f'Warning: Error occured in converting {k} {v} {e}')
                        continue
                records.append(record)
        return records

M_Type = RecordType(2052, {
            "Data Number": 'uint:16',
            "Character Code": 'bytes:2', 
            "Serial Sheet Number": 'uint:16',
            "JIS Code": 'hex:8',
            "EBCDIC Code": 'hex:8',
            "Evaluation of Individual Character Image": 'uint:8',
            "Evaluation of Character Group": 'uint:8',
            "Male-Female Code": 'uint:8',
            "Age of Writer": 'uint:8',
            "Serial Data Number": 'uint:32',
            "Industry Classification Code": 'uint:16',
            "Occupation Classification Code": 'uint:16',
            "Sheet Gatherring Date": 'uint:16',
            "Scanning Date": 'uint:16',
            "Sample Position Y on Sheet": 'uint:8',
            "Sample Position X on Sheet": 'uint:8',
            "Minimum Scanned Level": 'uint:8',
            "Maximum Scanned Level": 'uint:8',
            "Undefined1": 'pad:16',
            "Undefined2": 'pad:16',
            "Image Data": 'bytes:2016', 
            "Undefined3": 'pad:32'
    },
    {
        'char': lambda x: jaconv.h2z(bytes.fromhex(x['JIS Code']).decode('shift_jis'), digit=False, ascii=False).replace('ィ', 'ヰ').replace('ェ', 'ヱ'),
        'unicode': lambda x: hex(ord(x['char'])),
        'image': lambda x: Image.eval(Image.frombytes('F', (64, 63), x['Image Data'], 'bit', 4).convert('L'), lambda x: x * 16)
    }
)

K_Type = RecordType(2745, {
        "Serial Data Number": 'uint:36', 
        "Mark of Style": 'uint:6',
        'Spaces': 'pad:30',
        "Contents": 'bits:36',
        "Style": 'bits:36',
        'Zeros': 'pad:24',
        "CO-59 Code": 'bits:12',
        '(undefined)': 'pad:180',
        "Image Data": 'bytes:2700'
    },
    {
        'co-59_code': lambda x: tuple([b.uint for b in x['CO-59 Code'].cut(6)]),
        'char': lambda x: co59_to_unicode(x['co-59_code']),
        'unicode': lambda x: hex(ord(x['char'])),
        'image': lambda x: Image.eval(Image.frombytes('F', (60, 60), x['Image Data'], 'bit', 6).convert('L'), lambda x: x * 4),
        'mark_of_style': lambda x: T56(x['Mark of Style']),
        'contents': lambda x: ''.join([T56(b.uint) for b in x['Contents'].cut(6)]),
        'style': lambda x: ''.join([T56(b.uint) for b in x['Style'].cut(6)])
    }
)

C_Type = RecordType(2952, {
        "Serial Data Number": 'uint:36', 
        "Serial Sheet Number": 'uint:36', 
        "JIS Code": 'hex:8',
        '(pad1)': 'pad:28', 
        "EBCDIC Code": 'hex:8',
        '(pad2)': 'pad:28', 
        "4 Character Code": 'bits:24',
        'Spaces': 'bits:12',
        "Evaluation of Individual Character Image": 'uint:36', 
        "Evaluation of Character Group": 'uint:36',
        "Sample Position Y on Sheet": 'uint:36', 
        "Sample Position X on Sheet": 'uint:36',
        "Male-Female Code": 'uint:36', 
        "Age of Writer": 'uint:36', 
        "Industry Classification Code": 'uint:36', 
        "Occupation Classification Code": 'uint:36',
        "Sheet Gatherring Date": 'uint:36', 
        "Scanning Date": 'uint:36', 
        "Number of X-Axis Sampling Points": 'uint:36',
        "Number of Y-Axis Sampling Points": 'uint:36', 
        "Number of Levels of Pixel": 'uint:36',
        "Magnification of Scanning Lenz": 'uint:36', 
        "Serial Data Number (old)": 'uint:36', 
        '(undefined)': 'pad:1008',
        "Image Data": 'bytes:2736'
    },
    {
        '4_character_code': lambda x: ''.join([ T56(b.uint) for b in x['4 Character Code'].cut(6) ]),
        'spaces': lambda x: ''.join([ T56(b.uint) for b in x['Spaces'].cut(6) ]),
        'image': lambda x: Image.eval(Image.frombytes('F', (72,76), x['Image Data'], 'bit', 4).convert('L'), lambda x: x * 16),
        '_char': lambda x: bytes.fromhex(x['JIS Code']).decode('shift_jis'),
        'char': lambda x: 
            jaconv.kata2hira(jaconv.han2zen(x['_char'])).replace('ぃ', 'ゐ').replace('ぇ', 'ゑ') 
            if x['4 character code'][0] == 'H' else 
            jaconv.han2zen(x['_char']).replace('ィ', 'ヰ').replace('ェ', 'ヱ') 
            if x['4 character code'][0] == 'K' else x['_char'],
        'unicode': lambda x: hex(ord(x['char']))
    }
)

G8_Type = RecordType(8199, 
    {
        "Serial Sheet Number": 'uint:16', 
        "JIS Kanji Code": 'hex:16', 
        "JIS Typical Reading": 'bytes:8', 
        "Serial Data Number": 'uint:32',
        "Evaluation of Individual Character Image": 'uint:8', 
        "Evaluation of Character Group": 'uint:8',
        "Male-Female Code": 'uint:8', 
        "Age of Writer": 'uint:8',
        "Industry Classification Code": 'uint:16', 
        "Occupation Classification Code": 'uint:16',
        "Sheet Gatherring Date": 'uint:16', 
        "Scanning Date": 'uint:16',
        "Sample Position X on Sheet": 'uint:8', 
        "Sample Position Y on Sheet": 'uint:8',
        '(undefined)': 'pad:240',
        "Image Data": 'bytes:8128',
        '(uncertain)': 'pad:88'
    },
    {
        'JIS_kanji_code': lambda x: '1b2442' + x['JIS Kanji Code'] + '1b2842',
        'JIS_typical_reading': lambda x: x["JIS Typical Reading"].decode('ascii'),
        'char': lambda x: bytes.fromhex(x['JIS_kanji_code']).decode('iso2022_jp'),
        'unicode': lambda x: hex(ord(x['char'])),
        'image': lambda x: Image.eval(Image.frombytes('F', (128, 127), x['Image Data'], 'bit', 4).convert('L'),
            lambda x: x * 16)
    }
)

B8_Type = RecordType(512, 
    {
        "Serial Sheet Number": 'uint:16', 
        "JIS Kanji Code": 'hex:16', 
        "JIS Typical Reading": 'bytes:4', 
        "Image Data": 'bytes:504'
    },
    {
        'JIS_typical_reading': lambda x: x["JIS Typical Reading"].decode('ascii'),
        'char': lambda x: bytes.fromhex('1b2442' + x['JIS Kanji Code'] + '1b2842').decode('iso2022_jp'),
        'unicode': lambda x: hex(ord(x['char'])),
        'image': lambda x: Image.frombytes('1', (64, 63), x['Image Data'], 'raw')
    }
)

G9_Type = RecordType(8199, 
    {
        "Serial Sheet Number": 'uint:16', 
        "JIS Kanji Code": 'hex:16', 
        "JIS Typical Reading": 'bytes:8', 
        "Serial Data Number": 'uint:32',
        "Evaluation of Individual Character Image": 'uint:8', 
        "Evaluation of Character Group": 'uint:8',
        "Male-Female Code": 'uint:8', 
        "Age of Writer": 'uint:8',
        "Industry Classification Code": 'uint:16', 
        "Occupation Classification Code": 'uint:16',
        "Sheet Gatherring Date": 'uint:16', 
        "Scanning Date": 'uint:16',
        "Sample Position X on Sheet": 'uint:8', 
        "Sample Position Y on Sheet": 'uint:8',
        '(undefined)': 'pad:272',
        "Image Data": 'bytes:8128',
        '(uncertain)': 'pad:56'
    },
    {
        'JIS kanji code': lambda x: '1b2442' + x['JIS Kanji Code'] + '1b2842',
        'JIS typical reading': lambda x: x["JIS Typical Reading"].decode('ascii'),
        'char': lambda x: bytes.fromhex(x['JIS kanji code']).decode('iso2022_jp'),
        'unicode': lambda x: hex(ord(x['char'])),
        'image': lambda x: Image.eval(Image.frombytes('F', (128, 127), x['Image Data'], 'bit', 4).convert('L'),
            lambda x: x * 16)
    }
)

B9_Type = RecordType(576, 
    {
        "Serial Sheet Number": 'uint:16', 
        "JIS Kanji Code": 'hex:16', 
        "JIS Typical Reading": 'bytes:4', 
        "Image Data": 'bytes:504',
        '(uncertain)': 'pad:512'
    },
    {
        'JIS kanji code': lambda x: '1b2442' + x['JIS Kanji Code'] + '1b2842',
        'JIS typical reading': lambda x: x["JIS Typical Reading"].decode('ascii'),
        'char': lambda x: bytes.fromhex(x['JIS kanji code']).decode('iso2022_jp'),
        'unicode': lambda x: hex(ord(x['char'])),
        'image': lambda x: Image.frombytes('1', (64, 63), x['Image Data'], 'raw')
    }
)

if __name__ == '__main__':
    import argparse
    from pathlib import Path
    import pandas as pd
    from tqdm.contrib import tenumerate

    parser = argparse.ArgumentParser(description='Decompose ETLn files')
    parser.add_argument('input', help='input file')
    parser.add_argument('--fields', nargs='*', default=['char', 'unicode'], help='fields stored in meta.csv')

    args = parser.parse_args()

    input_path = Path(args.input)

    reader = {
        'ETL1': M_Type,
        'ETL2': K_Type,
        'ETL3': C_Type,
        'ETL4': C_Type,
        'ETL5': C_Type,
        'ETL6': M_Type,
        'ETL7': M_Type,
        'ETL8G': G8_Type,
        'ETL8B': B8_Type,
        'ETL9G': G9_Type,
        'ETL9B': B9_Type
    }

    dataset = input_path.parent.name

    skip_first = dataset in ['ETL8B', 'ETL9B']

    record = reader[dataset].read(input_path, skip_first)

    output_dir = input_path.parent / (input_path.name + '_unpack')
    output_dir.mkdir(exist_ok=True)

    for i, r in tenumerate(record):
        output_path = output_dir / f'{i:05d}.png'
        r['image'].save(output_path)

    records_df = pd.DataFrame(record, columns=args.fields)

    records_df.to_csv(output_dir / 'meta.csv')

