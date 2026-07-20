export class Card {
    /**
     * AF(n, id): A controlled, digital representation of the MIT Campus Trade trading card with the same
     *  collection mumber, corresponding name, and the same id number which distinguishes it from other cards of its number
     * 
     * RI: 
     *  - 1 <= number <= final dex number (unknown at present)
     *  - for all custody.length >= 2, custody[-1] !== custody[-2]
     * 
     * SFRE:
     *  - All instance variables
     */

    /**
     * Creates a Card
     * 
     * @param n collection/dex number of card
     * @param id individual instance of card
     */
    public constructor(
        public readonly n: number,
        public readonly id: number
    ) {
        const custody: Array<String> = []; // TODO make this a linked list to make it immutable and then just reassign completely internally?
        this.checkRep();
    }

    private checkRep() {

    }
}