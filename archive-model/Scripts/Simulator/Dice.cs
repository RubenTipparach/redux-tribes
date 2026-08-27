using Shapes;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public static class Dice
{

    public static int Roll(int numberOfTimes, int diceSize, int successThreshold)
    {
        if (successThreshold > diceSize)
        {
            throw new ArgumentException("Success threshold must be less than or equal to the dice size.");
        }

        int successCount = 0;

        for (int i = 0; i < numberOfTimes; i++)
        {
            int roll = UnityEngine.Random.Range(1, diceSize + 1);
            if (roll >= successThreshold)
            {
                successCount++;
            }
        }

        return successCount;
    }
}
